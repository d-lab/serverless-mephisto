const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        app_env: process.env.APP_ENV || 'app_env not set',
        app_name: process.env.APP_NAME || 'app_name not set',
    });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
