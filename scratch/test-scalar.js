const express = require('express');
const { apiReference } = require('@scalar/express-api-reference');
const app = express();
app.use('/docs', apiReference({ spec: { content: { openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: {} } } }));
app.listen(3001, () => console.log('Listening on 3001'));
