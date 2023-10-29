const { handler } = require('../lambda/updateTaskDns.js');
const fs = require('fs').promises; // Import the 'promises' version of the fs module.

async function main() {
    try {
        // Read the event from the JSON file
        const eventJSON = await fs.readFile('test/test-running-event.json', 'utf-8');
        const event = JSON.parse(eventJSON);

        // Pass the event to the handler function
        await handler(event, {});
    } catch (error) {
        console.error('Error:', error);
    }
}

main();
