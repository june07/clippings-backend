const Joi = require("joi")
const { objectId } = require('../../common/validations/joi.validations')

const contact = {
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    phone: Joi.string().pattern(
        new RegExp(/^\d{3}-\d{3}-\d{4}$/)
    ),
    relationship: Joi.string().required(),
}
const createContact = {
    payload: Joi.object().keys(contact)
}
const readContacts = {
    payload: Joi.object().keys({
        owner: Joi.string().required()
    })
}
const updateContact = {
    payload: Joi.object().keys({
        _id: objectId,
        owner: Joi.string().required(),
        ...contact
    })
}
const deleteContact = {
    payload: Joi.object().keys({
        _id: objectId,
    })
}

module.exports = {
    createContact,
    readContacts,
    updateContact,
    deleteContact
}