const dotenv = require('dotenv');
const path = require('path');
const Joi = require('joi');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const envVarsSchema = Joi.object()
    .keys({
        DD_API_KEY: Joi.string().required(),
        NODE_ENV: Joi.string().valid('production', 'development', 'test').required(),
        PORT: Joi.number().default(3000),
        MONGODB_URI: Joi.string().required().description('Mongo DB URI'),
        COOKIE_DOMAIN: Joi.string().required().description('Cookie Domain'),
        DOMAIN: Joi.string().required().description('Main Site Domain'),
        CORS_DOMAINS: Joi.string().required(),
        EXPRESS_SESSION_SECRET: Joi.string().required(),
        SENDINBLUE_API_KEY: Joi.string().required(),
        WEBPUSH_PUBLIC_KEY: Joi.string().required(),
        WEBPUSH_PRIVATE_KEY: Joi.string().required(),
        WEBPUSH_EMAIL: Joi.string().email().required(),
        LOGGLY_SUBDOMAIN: Joi.string().required()
    })
    .unknown();

const { value: envVars, error } = envVarsSchema.prefs({ errors: { label: 'key' } }).validate(process.env);

if (error) {
    throw new Error(`Config validation error: ${error.message}`);
}

module.exports = envVars;
