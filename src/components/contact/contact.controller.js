const contactService = require('./contact.service')

async function createContact(params, socket) {
    const { owner, name, email, phone, relationship } = params
    const { sessionId } = socket

    const ownerContact = await contactService.getOwnerContact(sessionId, owner)
    const contact = await contactService.createContact(ownerContact._id, name, email, phone, relationship)
    
    socket.emit('contactCreated', contact)
}
async function readContacts(socket) {
    const { owner } = socket

    const contacts = await contactService.readContacts(owner._id)
    
    return contacts
}
async function updateContact(params, socket) {
    const { _id, name, email, phone, relationship } = params
    const { owner } = socket

    const contact = await contactService.updateContact(_id, owner._id, name, email, phone, relationship)
    socket.emit('contactUpdated', contact)
}
async function deleteContact(params, socket) {
    const { _id } = params

    await contactService.deleteContact(_id)
    socket.emit('contactDeleted', { _id })
}
async function optIn(params, callback) {
    const { code } = params

    const contact = await contactService.optIn(code)
    
    callback(contact)
}
module.exports = {
    createContact,
    readContacts,
    updateContact,
    deleteContact,
    optIn,
}