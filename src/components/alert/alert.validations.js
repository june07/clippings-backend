const Joi = require("joi")
const { objectId } = require('../../common/validations/joi.validations')

const alert = {
    listingPid: Joi.string().required(),
    from: Joi.string().required(),
    to: Joi.array().items(
        objectId.required()
    ),
    message: Joi.alternatives().try(
        objectId.required(),
        Joi.string().required()
    ),
    sendAt: Joi.date().required(),
}
const createAlert = {
    payload: Joi.object().keys(alert)
}
const readAlerts = {
    payload: Joi.object().keys({
        owner: Joi.string().required()
    })
}
const updateAlert = {
    payload: Joi.object().keys({
        _id: objectId,
        owner: Joi.string().required(),
        ...alert
    })
}
const deleteAlert = {
    payload: Joi.object().keys({
        _id: objectId,
    })
}

module.exports = {
    createAlert,
    readAlerts,
    updateAlert,
    deleteAlert
}