import {StackContext} from "sst/constructs/FunctionalStack";
import {Service} from "sst/constructs";
import DockerImageBuilder from "./DockerImageBuilder";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";

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

    const cluster = new ecs.Cluster(stack, `${stack.stackName}-cluster`, {
        vpc,
        clusterName: `${stack.stackName}-cluster`
    })
    const logging = new ecs.AwsLogDriver({
        streamPrefix: `${stack.stackName}`,
        logRetention: logs.RetentionDays.ONE_WEEK,
    });
    const taskDefinition = new ecs.FargateTaskDefinition(stack, `${stack.stackName}-task`, {
        cpu: 256,
        memoryLimitMiB: 512,
    });
    const container = taskDefinition.addContainer(`${stack.stackName}-container`, {
        image: ecs.ContainerImage.fromDockerImageAsset(new DockerImageBuilder()
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
        portMappings: [{ containerPort: Number(process.env.CONT_PORT || 3000) }]
    });

    const createTaskLambda = new lambdaNode.NodejsFunction(stack, `${stack.stackName}-create-task`, {
        runtime: lambda.Runtime.NODEJS_18_X,
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

    const updateTaskDnsLambda = new lambdaNode.NodejsFunction(stack, `${stack.stackName}-update-task-dns`, {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: "./lambda/updateTaskDns.ts",
        handler: "handler",
        environment: {
            APP_ENV: process.env.APP_ENV as string,
            APP_NAME: process.env.APP_NAME as string,
            DOMAIN: process.env.DOMAIN as string | 'aufederal2022.com'
        }
    });
    const updateDnsPolicyStatement = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            'ec2:DescribeNetworkInterfaces',
            'ecs:DescribeClusters',
            'route53:ChangeResourceRecordSets',
        ],
        resources: [
            '*'
        ]
    });
    updateTaskDnsLambda.addToRolePolicy(updateDnsPolicyStatement);

    const rule = new events.Rule(stack, `${stack.stackName}-rule`, {
        eventPattern: {
            source: ["aws.ecs"],
            detailType: ["ECS Task State Change"],
            detail: {
                desiredStatus: ["RUNNING"],
                lastStatus: ["RUNNING"]
            }
        }
    });
    rule.addTarget(new targets.LambdaFunction(updateTaskDnsLambda));

    const runTaskPolicyStatement = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            'ecs:RunTask'
        ],
        resources: [
            taskDefinition.taskDefinitionArn,
        ]
    });
    createTaskLambda.addToRolePolicy(runTaskPolicyStatement);

    const taskExecutionRolePolicyStatement = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
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