const ContactModel = require('./contact.model')

async function createContact(owner, name, email, phone, relationship) {
    const contact = await ContactModel.create({ owner, name, email, phone, relationship })

    const lean = contact.toObject({ getters: true, virtuals: true })
    delete lean.__v

    return lean
}
async function readContacts(owner) {
    const contacts = await ContactModel.find({ owner }, { '__v': 0 }, { lean: true })
    return contacts
}
async function updateContact(_id, owner, name, email, phone, relationship) {
    const contactObj = { _id, owner, name, email, phone, relationship }
    const contact = await ContactModel.findOneAndUpdate({ _id }, contactObj, { lean: true, new: true, upsert: true })
    return { ...contact, _id: contact._id.toString() }
}
async function deleteContact(_id) {
    await ContactModel.findByIdAndDelete(_id)
}

module.exports = {
    readContacts,
    createContact,
    updateContact,
    deleteContact
}