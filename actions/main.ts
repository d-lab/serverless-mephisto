import { getInput, setFailed, info } from '@actions/core';
import { execAsync } from './utils/commandExecution';
import * as subProcess from 'child_process';
import * as fs from 'fs';

async function run(): Promise<void> {
    try {
        info("Cloning deployment kit into the board");
        await execAsync(`git clone --branch ${process.env.SVLD_VERSION as string} https://github.com/d-lab/serverless-mephisto .deploy`)
        await execAsync("mkdir -p ./.deploy/app_src && rsync -a --exclude=./.deploy ./ ./.deploy/app_src");
        
        info("Signing in ECR");
        await execAsync(`aws ecr get-login-password --region ${process.env.AWS_REGION as string} | docker login --username AWS ` +
            `--password-stdin ${process.env.AWS_ACCOUNT_ID as string}.dkr.ecr.${process.env.AWS_REGION as string}.amazonaws.com`);
        
        info("Installing dependencies...");
        await execAsync(`cd .deploy && npm install`);
        await execAsync(`sudo apt install -y jq`);

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

        stream.on('exit', async () => {
            const execTimeInMillis = (new Date().getTime() - startTime);
            let execTime = Math.ceil(execTimeInMillis / 60000);
            info(`Deployment process time: ${execTime} minutes`);

            let previewUrlPattern = null;
            const prolificConfigs = fs.readFileSync('./.deploy/app_src/app/deploy.py', 'utf-8').split('\n')
                    .map(line => line.trim().toLowerCase())
                    .filter(line => line.startsWith("default_config_file") && line.includes("prolific"));
            if (process.env.APP_ENV === 'prod') {
                if (prolificConfigs.filter(line => line.includes("prod")).length > 0) {
                    info("Using Prolific");
                    previewUrlPattern = '%Prolific Study .* has been published successfully with ID%';
                } else {
                    info("Using MTurk");
                    previewUrlPattern = '%mturk\\.com/mturk/preview\\?groupId=%';
                }
            } if (process.env.APP_ENV === 'test' || process.env.APP_ENV === 'sb') {
                if (prolificConfigs.filter(line => line.includes("test") || line.includes("sb")).length > 0) {
                    info("Using Prolific");
                    previewUrlPattern = '%Prolific Study .* has been published successfully with ID%';
                } else {
                    info("Using MTurk");
                    previewUrlPattern = '%mturk\\.com/mturk/preview\\?groupId=%';
                }
            } else {
                previewUrlPattern = '%Mock task launched.* for preview%';
            }
            const grepPattern = previewUrlPattern?.slice(1,-1).replaceAll("\\", "");

            info("Preview URL pattern: " + previewUrlPattern);
            info("Waiting for confirmation...");
        
            const getLogStreamSubCmd = `$(aws ecs list-tasks --cluster ${process.env.APP_ENV}-${process.env.APP_NAME}-DefaultServiceStack-cluster --desired-status RUNNING | jq -r '.taskArns[0]' | awk -v delimeter='task/' '{split($0,a,delimeter)} END{print a[2]}' | awk -v delimeter='-cluster/' '{split($0,a,delimeter)} END{printf "%s/%s-container/%s", a[1], a[1], a[2]}' || '')`;
            
            const TIMEOUT = 1800000;
            await execAsync(`export check_time="${new Date(startTime).toISOString()}" && while ! aws logs tail mephisto-apps-log-group --log-stream-names ${getLogStreamSubCmd} --filter-pattern="${previewUrlPattern}" --since ${execTime}m | grep "${grepPattern}"; do export last_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ"); aws logs tail mephisto-apps-log-group --log-stream-names ${getLogStreamSubCmd} --since $check_time; export check_time=$last_time; sleep 2; done`,
            {
                timeout: TIMEOUT // millis
            },
            {
                replace: {
                    pattern: new RegExp(`${process.env.APP_ENV}-${process.env.APP_NAME}-DefaultServiceStack\/${process.env.APP_ENV}-${process.env.APP_NAME}-DefaultServiceStack-container\/[a-zA-Z0-9]+`, 'g'),
                    by: ''
                }
            });

            if ((new Date().getTime() - startTime) >= TIMEOUT + execTimeInMillis) {
                setFailed("Can't get confirmation before timeout")
            }
        
        
            // execTime = Math.ceil((new Date().getTime() - startTime) / 60000);
            // await execAsync(`aws logs tail mephisto-apps-log-group --log-stream-names ${getLogStreamSubCmd} --filter-pattern="${previewUrlPattern}" --since ${execTime}m`);
        });
        
    } catch (e: any) {
        setFailed(e);
    }
}

run();