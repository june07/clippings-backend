const Joi = require("joi")
const { objectId } = require('../../common/validations/joi.validations')

const contact = {
    owner: Joi.alternatives().try(
        Joi.object().keys({
            name: Joi.string().required(),
            email: Joi.string().email(),
            phone: Joi.string().pattern(
                new RegExp(/^\d{3}-\d{3}-\d{4}$/)
            )
        }),
        objectId
    ).required(),
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    phone: Joi.string().pattern(
        new RegExp(/^\d{3}-\d{3}-\d{4}$/)
    ),
    relationship: Joi.string().required(),
    optedIn: Joi.boolean(),
    code: Joi.string(),
}
const createContact = {
    payload: Joi.object().keys(contact)
}
const updateContact = {
    payload: Joi.object().keys({
        _id: objectId,
        ...contact
    })
}
const deleteContact = {
    payload: Joi.object().keys({
        _id: objectId,
    })
}
const optIn = {
    payload: Joi.object().keys({
        code: Joi.string().required(),
    })
}

module.exports = {
    createContact,
    updateContact,
    deleteContact,
    optIn
}