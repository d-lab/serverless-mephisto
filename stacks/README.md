## The stack contains:
- A task definition that specifies the container image to run and the ports to expose.
- A cluster that is used to run the task definition.
- A security group that allows inbound traffic on the ports that the task definition exposes. Port 2049 is opened due to the use of EFS.
- An EFS volume that is used to store the Mephisto app data.
- A Lambda function that is triggered when a new task is created.
- A Lambda function updates the DNS record for the task so that it can be accessed through the domain name. Because this Lambda function is triggered anytime the status of a task changes, it is required to check if the stack name matches the current task.

## Notes:
- All stacks will use the same log group with different log stream prefix base on stack name.
- Cluster, Security Group, Task Definition, EFS and EFS Access Point must be available before triggering createTaskLambda.

## Docker Image Builder:
- Each of images built by this builder are pushed to ECR with a random tag.