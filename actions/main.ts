import { getInput, setFailed, info } from '@actions/core';
import * as subProcess from 'child_process';

async function run(): Promise<void> {
    try {
        info("Cloning deployment kit into the board");
        subProcess.execSync(`git clone --branch ${process.env.SVLD_VERSION as string} https://github.com/cngthnh/serverless-mephisto .deploy`)
        subProcess.execSync("mkdir -p ./.deploy/app_src && rsync -a --exclude=./.deploy ./ ./.deploy/app_src");
        
        info("Signing in ECR");
        let buffer = subProcess.execSync(`aws ecr get-login-password --region ${process.env.AWS_REGION as string} | docker login --username AWS ` +
            `--password-stdin ${process.env.AWS_ACCOUNT_ID as string}.dkr.ecr.${process.env.AWS_REGION as string}.amazonaws.com`);
        info(buffer.toString());
        
        info("Installing dependencies...");
        buffer = subProcess.execSync(`cd .deploy && npm install`);
        info(buffer.toString());

        // info("Removing old stacks");
        // buffer = subProcess.execSync(`cd .deploy && echo "${process.env.APP_ENV}" | npm run remove`);
        // info(buffer.toString());

        // const repoName = `${process.env.APP_NAME}-${process.env.APP_ENV}`;
        // info("Creating repository...");
        // buffer = subProcess.execSync(`cd .deploy && aws ecr create-repository --repository-name "${repoName}" --region ${process.env.AWS_REGION} || true`);
        // info(buffer.toString());

        // info("Putting lifecycle policy...");
        // buffer = subProcess.execSync(`cd .deploy && aws ecr put-lifecycle-policy --repository-name "${repoName}" --lifecycle-policy-text file://$(pwd)/conf/lifecycle_policy.json || true`);
        // info(buffer.toString());

        info("Deploying...");

        const startTime = new Date().getTime();

        let stream = subProcess.exec(`cd .deploy && echo "${process.env.APP_ENV}" | npm run deploy`);
        stream.stdout?.on('data', (data) => {
            info(data);
        });
        stream.stderr?.on('data', (data) => {
            info("stderr: " + data);
        });

        stream.on('exit', () => {
            info("Waiting for confirmation...");

            const execTime = Math.ceil((new Date().getTime() - startTime) / 60000);
            info(`Deployment process time: ${execTime} minutes`);

            const grepPattern = process.env.PREVIEW_URL_PREFIX?.slice(1,-1);
            buffer = subProcess.execSync(`while ! aws logs tail /sst/service/${process.env.APP_ENV}-serverless-${process.env.APP_NAME}-${process.env.APP_ENV}-${process.env.APP_NAME}-${process.env.APP_ENV} --filter-pattern '${process.env.PREVIEW_URL_PREFIX}' --since ${execTime}m | grep '${grepPattern}'; do sleep 5; done`);
            
            buffer = subProcess.execSync(`aws logs tail /sst/service/${process.env.APP_ENV}-serverless-${process.env.APP_NAME}-${process.env.APP_ENV}-${process.env.APP_NAME}-${process.env.APP_ENV} --filter-pattern '${process.env.PREVIEW_URL_PREFIX}' --since ${execTime}m`)
            info(buffer.toString());
        });
        
    } catch (e: any) {
        setFailed(e);
    }
}

run();