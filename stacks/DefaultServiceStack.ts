import {StackContext} from "sst/constructs/FunctionalStack";
import {Service} from "sst/constructs";
import DockerImageBuilder from "./DockerImageBuilder";
import {ContainerImage, Cluster, FargateTaskDefinition, AwsLogDriver} from "aws-cdk-lib/aws-ecs";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import {Function, Runtime, Code} from "aws-cdk-lib/aws-lambda";
import {NodejsFunction} from "aws-cdk-lib/aws-lambda-nodejs";
import {PolicyStatement, Effect} from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";

export function DefaultServiceStack({stack}: StackContext) {
    const vpc = ec2.Vpc.fromLookup(stack, `${stack.stackName}-vpc`, {
        vpcId: process.env.VPC_ID
    });
    const securityGroup = new ec2.SecurityGroup(stack, `${stack.stackName}-security-group`, {
        vpc,
        allowAllOutbound: true,
        securityGroupName: `${stack.stackName}-security-group`
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3000), 'Allow incoming on port 3000');

    const cluster = new Cluster(stack, `${stack.stackName}-cluster`, {
        vpc,
        clusterName: `${stack.stackName}-cluster`
    })
    const logging = new AwsLogDriver({
        streamPrefix: `${stack.stackName}`,
        logRetention: RetentionDays.ONE_WEEK,
    });
    const taskDefinition = new FargateTaskDefinition(stack, `${stack.stackName}-task`, {
        cpu: 256,
        memoryLimitMiB: 512,
    });
    const container = taskDefinition.addContainer(`${stack.stackName}-container`, {
        image: ContainerImage.fromDockerImageAsset(new DockerImageBuilder()
            .withStack(stack)
            .withName(`${stack.stackName}-container`)
            .withPath("./app_test")
            .withBuildArgs({
                GIT_USER_EMAIL: process.env.GIT_USER_EMAIL as string,
                GIT_USER_NAME: process.env.GIT_USER_NAME as string,
                MTURK_NAME: process.env.MTURK_NAME as string,
                MTURK_TYPE: process.env.MTURK_TYPE as string,
                MTURK_ACCESS_KEY_ID: process.env.MTURK_ACCESS_KEY_ID as string,
                MTURK_SECRET_ACCESS_KEY: process.env.MTURK_SECRET_ACCESS_KEY as string,
                DOTNETRC: process.env.DOTNETRC as string,
                HEROKU_API_KEY: process.env.HEROKU_API_KEY as string,
                PROLIFIC_API_KEY: process.env.PROLIFIC_API_KEY as string,
                AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID as string,
                AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY as string
            })
            .build()
            .getImage()),
        logging,
        environment: {
            APP_ENV: process.env.APP_ENV as string,
            APP_NAME: process.env.APP_NAME as string
        },
        portMappings: [{ containerPort: 3000 }]
    });

    const createTaskLambda = new NodejsFunction(stack, `${stack.stackName}-create-task`, {
        runtime: Runtime.NODEJS_18_X,
        entry: "./lambda/createTask.ts",
        handler: "handler",
        reservedConcurrentExecutions: 1,
        environment: {
            CLUSTER_NAME: cluster.clusterName,
            TASK_DEFINITION: taskDefinition.taskDefinitionArn,
            SUBNETS: JSON.stringify(Array.from(vpc.publicSubnets, subnet => subnet.subnetId)),
            CONTAINER_NAME: container.containerName,
            SECURITY_GROUP: securityGroup.securityGroupId
        }
    });

    const runTaskPolicyStatement = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
            'ecs:RunTask'
        ],
        resources: [
            taskDefinition.taskDefinitionArn,
        ]
    });
    createTaskLambda.addToRolePolicy(runTaskPolicyStatement);

    const taskExecutionRolePolicyStatement = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
            'iam:PassRole',
        ],
        resources: [
            taskDefinition.obtainExecutionRole().roleArn,
            taskDefinition.taskRole.roleArn,
        ]
    });
    createTaskLambda.addToRolePolicy(taskExecutionRolePolicyStatement);
}