module.exports = {
    testTimeout: 300000,
    testEnvironment: 'node',
    testEnvironmentOptions: {
        NODE_ENV: 'test',
    },
    restoreMocks: true,
    coveragePathIgnorePatterns: ['node_modules', 'src/config', 'src/app.js', 'tests'],
    coverageReporters: ['text', 'lcov', 'clover', 'html'],
    setupFiles: ['dotenv/config']
};
