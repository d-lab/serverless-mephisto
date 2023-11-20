# serverless-mephisto

## CloudFormation stack details
Read stacks/README.md

## How to run test
- Update package.json to `"type": "commonjs"`
- Run `tsc -w lambda/updateTaskDns.ts`
- Run `node test/test.js`