import {Context, APIGatewayProxyResult, APIGatewayEvent} from 'aws-lambda';
import {
    ECSClient,
    RunTaskRequest,
    RunTaskCommand,
    RunTaskCommandOutput,
    ListTasksCommand,
    StopTaskCommand
} from "@aws-sdk/client-ecs";

const ecsClient = new ECSClient({
    region: 'ap-southeast-2',
});
const stopOldTask = async (clusterName: string) => {
    try {
        const listTaskCommand = new ListTasksCommand({
            cluster: clusterName,
            desiredStatus: 'RUNNING',
        });
        const listTaskCommandOutput = await ecsClient.send(listTaskCommand);

        if (listTaskCommandOutput.taskArns && listTaskCommandOutput.taskArns.length > 0) {
            console.log(`Found ${listTaskCommandOutput.taskArns.length} running tasks`);
            for (const taskArn of listTaskCommandOutput.taskArns) {
                console.log(`Stopping task ${taskArn}`);
                const stopTaskCommand = new StopTaskCommand({
                    cluster: clusterName,
                    task: taskArn,
                });
                await ecsClient.send(stopTaskCommand);
            }
        } else {
            console.log('No running task found');
            return;
        }
    } catch (error) {
        console.log(`Error: ${error}`);
    }
}
export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    console.log(`Event: ${JSON.stringify(event, null, 2)}`);
    console.log(`Context: ${JSON.stringify(context, null, 2)}`);

    // Extract variables from environment
    const clusterName = process.env.CLUSTER_NAME;
    if (typeof clusterName === 'undefined') {
        throw new Error('Cluster Name is not defined');
    }

    const taskDefinition = process.env.TASK_DEFINITION;
    if (typeof taskDefinition === 'undefined') {
        throw new Error('Task Definition is not defined');
    }

    const subNets = process.env.SUBNETS;
    if (typeof subNets === 'undefined') {
        throw new Error('SubNets are not defined');
    }

    const containerName = process.env.CONTAINER_NAME;
    if (typeof containerName === 'undefined') {
        throw new Error('Container Name is not defined');
    }

    const securityGroup = process.env.SECURITY_GROUP;
    if (typeof securityGroup === 'undefined') {
        throw new Error('Security Group is not defined');
    }

    console.log('Cluster Name - ' + clusterName);
    console.log('Task Definition - ' + taskDefinition);
    console.log('SubNets - ' + subNets);
    console.log('Security Group - ' + securityGroup);

    await stopOldTask(clusterName);

    const command = new RunTaskCommand({
        cluster: clusterName,
        launchType: 'FARGATE',
        taskDefinition: taskDefinition,
        count: 1,
        platformVersion: 'LATEST',
        networkConfiguration: {
            awsvpcConfiguration: {
                subnets: JSON.parse(subNets),
                assignPublicIp: 'ENABLED',
                securityGroups: [
                    securityGroup,
                ],
            },
        },
        enableExecuteCommand: true,
    } as RunTaskRequest);

    try {
        const data: RunTaskCommandOutput = await ecsClient.send(command);
        console.log(`Data: ${JSON.stringify(data, null, 2)}`);
        // process data.
    } catch (error) {
        throw new Error(`Having Error: ${error}`);
        // error handling.
    }


    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Success!',
        }),
    };
};