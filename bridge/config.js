export const config = {
  port: parseInt(process.env.CLAUDE_DJ_PORT, 10) || 39200,
  buttonTimeout: parseInt(process.env.CLAUDE_DJ_BUTTON_TIMEOUT, 10) || 30000,
  hookTimeout: 110000,
  wsPath: '/ws',
  apiPrefix: '/api',
  version: '0.1.0',
};
