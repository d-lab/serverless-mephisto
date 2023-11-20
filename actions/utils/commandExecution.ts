import * as subProcess from 'child_process';
import { info } from '@actions/core';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const execAsync = async (command: string, options: any = undefined) => {
    let closed = false;
    const stream = subProcess.exec(command, options);
    stream.stdout?.on('data', (data) => {
        info(data);
    });
    stream.stderr?.on('data', (data) => {
        info(data);
    });
    stream.stdout?.on('close', () => {
        closed = true;
    });
    while (!closed) {
        await sleep(5000);
    }
}