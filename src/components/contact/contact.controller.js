const contactService = require('./contact.service')

async function createContact(params, socket) {
    const { name, email, phone, relationship } = params
    const owner = socket.sessionId

    const contact = await contactService.createContact(owner, name, email, phone, relationship)
    
    socket.emit('contactCreated', contact)
}
async function readContacts(socket) {
    const owner = socket.sessionId

    const contacts = await contactService.readContacts(owner)
    
    return contacts
}
async function updateContact(params, socket) {
    const { _id, owner, name, email, phone, relationship } = params

    if (owner !== socket.sessionId) {
        socket.emit(new Error(`can't update a contact owned by someone else.`))
        return
    }

    const contact = await contactService.updateContact(_id, owner, name, email, phone, relationship)
    socket.emit('contactUpdated', contact)
}
async function deleteContact(params, socket) {
    const { _id } = params

    const contact = await contactService.deleteContact(_id)
    socket.emit('contactDeleted', contact)
}

module.exports = {
    createContact,
    readContacts,
    updateContact,
    deleteContact
}