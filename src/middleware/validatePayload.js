const Joi = require('joi')
const httpStatus = require('http-status')
const pick = require('../utils/pick')
const ApiError = require('../utils/ApiError')

const validatePayload = (payload, schema, callback) => {
    const validSchema = pick(schema, ['payload'])
    const { value, error } = Joi.compile(validSchema.payload)
        .prefs({ errors: { label: 'key' } })
        .validate(payload)

    if (error) {
        const errorMessage = error.details.map((details) => details.message).join(', ')
        callback(new ApiError(httpStatus.BAD_REQUEST, errorMessage))
    } else {
        callback()
    }
}

module.exports = validatePayload
