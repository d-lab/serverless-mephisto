import * as subProcess from 'child_process';
import { info } from '@actions/core';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const execAsync = async (command: string, options: any = undefined, filter: any = undefined) => {
    let closed = false;
    const stream = subProcess.exec(command, options);
    stream.stdout?.on('data', (data) => {
        info(applyFilter(data, filter));
    });
    stream.stderr?.on('data', (data) => {
        info(applyFilter(data, filter));
    });
    stream.stdout?.on('close', () => {
        closed = true;
    });
    while (!closed) {
        await sleep(5000);
    }
}

function applyFilter(data: any, filter: any) {
    if (!filter) {
        return data;
    }
    let result = data;
    if (filter.replace) {
        result = result.replaceAll(filter.replace.pattern, filter.replace.by);
    }
    return result;
}
