const ContactModel = require('./contact.model')
const { mailService } = require('../../common/services')

async function createContact(ownerContactId, name, email, phone, relationship) {
    const { nanoid } = await import('nanoid')
    const contact = await ContactModel.create({ owner: ownerContactId, name, email, phone, relationship, code: nanoid() })
    await contact.populate({
        path: 'owner',
        select: { '__v': 0 }
    })

    const lean = contact.toObject({ getters: true, virtuals: true })
    delete lean.__v

    mailService.sendOptIn({ name: lean.relationship, address: lean.email }, lean.owner.name, contact.code)

    return lean
}
async function readContacts(ownerId) {
    const contacts = await ContactModel.find({ owner: ownerId }, { '__v': 0, 'code': 0 }, { lean: true })
    return contacts
}
async function updateContact(_id, ownerId, name, email, phone, relationship) {
    const contactObj = { _id, owner: ownerId, name, email, phone, relationship }
    let contact = await ContactModel.findOneAndUpdate({ _id }, contactObj, { lean: true, upsert: true })
        .populate({
            path: 'owner',
            select: { '__v': 0 }
        })

    if (contactObj.email !== contact.email) {
        const { nanoid } = await import('nanoid')
        const code = nanoid()
        contact = await ContactModel.findOneAndUpdate({ _id }, { optedIn: false, code }, { lean: true, new: true, upsert: true })
        mailService.sendOptIn({ name: contact.relationship, address: contact.email }, contact.owner.name, code)
        return { ...contact, _id: contact._id.toString() }
    }

    // need to return the contactObj not the contact since the contact is pre-update needed to compare email values
    return { ...contactObj, _id: contact._id.toString() }
}
async function deleteContact(_id) {
    await ContactModel.findByIdAndDelete(_id)
}
async function getOwnerContact(sessionId, owner) {
    const contactObj = { ...owner, sessionId, relationship: 'self' }
    const contact = await ContactModel.findOneAndUpdate({ sessionId }, contactObj, { lean: true, new: true, upsert: true })
    return contact
}
async function optIn(code) {
    const contact = await ContactModel.findOneAndUpdate({ code }, { optedIn: true }, { lean: true })
        .populate({
            path: 'owner',
            select: { 'name': 1, '_id': 0 }
        })
    return contact
}

module.exports = {
    readContacts,
    createContact,
    updateContact,
    deleteContact,
    getOwnerContact,
    optIn
}