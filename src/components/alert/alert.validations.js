const Joi = require("joi")
const { objectId } = require('../../common/validations/joi.validations')

const alert = {
    listingPid: Joi.string().required(),
    from: Joi.string().required(),
    to: Joi.array().items(
        objectId.required()
    ),
    message: objectId.required(),
    sendAt: Joi.date().min(Date.now() + 3600000).required()
}
const createAlert = {
    payload: Joi.object().keys(alert)
}
const readAlerts = {
    payload: Joi.object().keys({})
}
const updateAlert = {
    payload: Joi.object().keys({
        _id: objectId.required(),
        owner: Joi.string().required(),
        ...alert
    })
}
const deleteAlert = {
    payload: Joi.object().keys({
        _id: objectId.required(),
    })
}

module.exports = {
    createAlert,
    readAlerts,
    updateAlert,
    deleteAlert
}