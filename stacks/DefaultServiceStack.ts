import { StackContext } from "sst/constructs/FunctionalStack";
import { Service, dependsOn, Script } from "sst/constructs";
import DockerImageBuilder from "./DockerImageBuilder";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as triggers from "aws-cdk-lib/triggers";
import { Duration, RemovalPolicy } from "aws-cdk-lib";

export function DefaultServiceStack({ stack }: StackContext) {
    const vpc = ec2.Vpc.fromLookup(stack, `${stack.stackName}-vpc`, {
        vpcId: process.env.VPC_ID
    });
    const securityGroup = new ec2.SecurityGroup(stack, `${stack.stackName}-security-group`, {
        vpc,
        allowAllOutbound: true,
        securityGroupName: `${stack.stackName}-security-group`
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3000), 'Allow incoming on port 3000');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(2049), 'Allow incoming on port 2049');

    const cluster = new ecs.Cluster(stack, `${stack.stackName}-cluster`, {
        vpc,
        clusterName: `${stack.stackName}-cluster`
    });

    let logGroup = logs.LogGroup.fromLogGroupName(stack, `${stack.stackName}-lg`, `mephisto-apps-log-group`);
    const logging = new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: `${stack.stackName}`
    });

    const taskDefinition = new ecs.FargateTaskDefinition(stack, `${stack.stackName}-task`, {
        cpu: 256,
        memoryLimitMiB: 512
    });
    taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            'ssmmessages:CreateControlChannel',
            'ssmmessages:CreateDataChannel',
            'ssmmessages:OpenControlChannel',
            'ssmmessages:OpenDataChannel',
        ],
        resources: ['*']
    }));


    const container = taskDefinition.addContainer(`${stack.stackName}-container`, {
        image: ecs.ContainerImage.fromDockerImageAsset(new DockerImageBuilder()
            .withStack(stack)
            .withName(`${stack.stackName}-container`)
            // .withPath("./app_test")
            .withPath("./app_src/app")
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
        stopTimeout: Duration.seconds(Number(process.env.STOP_TIMEOUT || 30)),
        environment: {
            APP_ENV: process.env.APP_ENV as string,
            APP_NAME: process.env.APP_NAME as string
        },
        portMappings: [{ containerPort: Number(process.env.CONT_PORT || 3000) }]
    });

    const fs = new efs.FileSystem(stack, `${stack.stackName}-fs`, {
        vpc,
        // vpcSubnets: {
        //     availabilityZones: [vpc.availabilityZones[0]],
        //     onePerAz: true
        // },
        encrypted: false,
        lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS,
        performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
        removalPolicy: RemovalPolicy.RETAIN,
        fileSystemName: `${stack.stackName}-fs`,
        enableAutomaticBackups: false,
        securityGroup
    });

    const efsAccessPoint = fs.addAccessPoint(`${stack.stackName}-efs-ap`);
    efsAccessPoint.node.addDependency(fs);

    const efsMountPolicy = (new iam.PolicyStatement({
        actions: [
            'elasticfilesystem:ClientMount',
            'elasticfilesystem:ClientWrite',
            'elasticfilesystem:ClientRootAccess'
        ], 
        resources: [
            efsAccessPoint.accessPointArn,
            fs.fileSystemArn
        ]
    }))

    taskDefinition.addToTaskRolePolicy(efsMountPolicy);
    taskDefinition.addToExecutionRolePolicy(efsMountPolicy);

    const assetVolume: ecs.Volume = {
        efsVolumeConfiguration: {
            fileSystemId: fs.fileSystemId,
        },
        name: `${stack.stackName}-asset-volume`,
    };

    taskDefinition.addVolume(assetVolume);
    
    container.addMountPoints({
        sourceVolume: assetVolume.name,
        containerPath: "/mephisto/data/results",
        readOnly: false,
    });

    const createTaskLambda = new lambdaNode.NodejsFunction(stack, `${stack.stackName}-create-task-${Date.now().toString()}`, {
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
            CLUSTER_NAME: cluster.clusterName,
            APP_ENV: process.env.APP_ENV as string,
            APP_NAME: process.env.APP_NAME as string,
            DOMAIN: process.env.DOMAIN as string | 'aufederal2022.com'
        }
    });

    const lambdaEfsMountedFolder = "/efs";

    const syncS3Lambda = new lambdaNode.NodejsFunction(stack, `${stack.stackName}-update-task-dns`, {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: "./lambda/syncS3.ts",
        handler: "handler",
        role: taskDefinition.taskRole,
        environment: {
            BUCKET_NAME: 'mephisto-data',
            AWS_REGION: process.env.AWS_REGION as string,
            S3_PATH: `/data-v2/${process.env.APP_NAME}`,
            EFS_MOUNTED_FOLDER: lambdaEfsMountedFolder
        },
        timeout: Duration.minutes(10),
        vpc: vpc,
        filesystem: lambda.FileSystem.fromEfsAccessPoint(efsAccessPoint, lambdaEfsMountedFolder)
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

    const runningTaskRule = new events.Rule(stack, `${stack.stackName}-running-task-rule`, {
        eventPattern: {
            source: ["aws.ecs"],
            detailType: ["ECS Task State Change"],
            detail: {
                desiredStatus: ["RUNNING"],
                lastStatus: ["RUNNING"]
            }
        }
    });
    runningTaskRule.addTarget(new targets.LambdaFunction(updateTaskDnsLambda));

    const deleteTaskRule = new events.Rule(stack, `${stack.stackName}-delete-task-rule`, {
        eventPattern: {
            source: ["aws.ecs"],
            detailType: ["ECS Task State Change"],
            detail: {
                desiredStatus: ["STOPPED"],
                lastStatus: ["DEPROVISIONING", "RUNNING", "STOPPED"]
            }
        }
    });
    deleteTaskRule.addTarget(new targets.LambdaFunction(updateTaskDnsLambda));
    deleteTaskRule.addTarget(new targets.LambdaFunction(syncS3Lambda));

    const runTaskPolicyStatement = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            'ecs:RunTask',
            'ecs:StopTask',
            'ecs:ListTasks'
        ],
        resources: ['*']
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

    const triggerCreateTask = new triggers.Trigger(stack, `${stack.stackName}-${Date.now().toString()}`, {
        handler: createTaskLambda,
        timeout: Duration.minutes(10),
        invocationType: triggers.InvocationType.EVENT,
    });
    triggerCreateTask.executeAfter(createTaskLambda, updateTaskDnsLambda, securityGroup, cluster, taskDefinition, fs, efsAccessPoint);
}
