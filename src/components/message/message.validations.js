const Joi = require("joi")
const { objectId } = require('../../common/validations/joi.validations')

const message = {
    text: Joi.string().required(),
    title: Joi.string().required(),
}
const createMessage = {
    payload: Joi.object().keys(message)
}
const readMessages = {
    payload: Joi.object().keys({
        owner: Joi.string().required()
    })
}
const updateMessage = {
    payload: Joi.object().keys({
        _id: objectId,
        owner: Joi.string().required(),
        ...message
    })
}
const deleteMessage = {
    payload: Joi.object().keys({
        _id: objectId,
    })
}

module.exports = {
    createMessage,
    readMessages,
    updateMessage,
    deleteMessage
}