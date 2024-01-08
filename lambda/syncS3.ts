import { promises as fs, createReadStream } from 'fs';
import * as path from 'path';
import { Context, APIGatewayProxyResult, EventBridgeEvent } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

async function uploadDir(localPath: string) {
    const bucketName = process.env.BUCKET_NAME;
    console.log("Bucket name: ", bucketName);
    
    const s3Path = process.env.S3_PATH as string;
    console.log("S3 path: ", s3Path);

    const client = new S3Client({ region: process.env.REGION });

    async function getFiles(dir: string): Promise<string | string[]> {
        const dirents = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(
            dirents.map((dirent) => {
                const res = path.resolve(dir, dirent.name);
                return dirent.isDirectory() ? getFiles(res) : res;
            })
        );
        return Array.prototype.concat(...files);
    }

    const files = (await getFiles(localPath)) as string[];
    console.log("Local files: ", files);

    const uploads = files.map((filePath) => {
        const fileKey = path.resolve(s3Path, path.relative(localPath, filePath)).substring(1);
        console.log(fileKey);
        return client.send(new PutObjectCommand({
            Key: fileKey,
            Bucket: bucketName,
            Body: createReadStream(filePath),
        }));
    }
        
    );
    return Promise.all(uploads);
}

export const handler = async (event: EventBridgeEvent<any, any>, context: Context): Promise<APIGatewayProxyResult | undefined> => {

    const task = event.detail;
    const clusterArn = task.clusterArn;
    console.log(`clusterArn: ${clusterArn}`);

    const clusterName = clusterArn.split(':cluster/')[1];

    if (clusterName !== process.env.CLUSTER_NAME) {
        console.log("Another app triggered, skip for this cluster");
        return;
    }

    const localPath = process.env.EFS_MOUNTED_FOLDER as string;
    console.log(`Syncing from EFS [${localPath}] to S3 folder ${process.env.S3_PATH}`)
    try {
        await uploadDir(localPath);
        console.log("Sync S3 completed!")
    } catch (err) {
        console.log("Sync S3 failed!");
        console.log("Exception: ", err);
    }

    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Success!',
        }),
    };
}