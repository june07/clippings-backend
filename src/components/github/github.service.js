const { mapSeries } = require('async')
const { Octokit } = require("@octokit/rest")

const { logger } = require('../../config')

const { GITHUB_USER, GITHUB_REPO, GITHUB_TOKEN, DOMAIN } = process.env
const namespace = 'jc-backend:github:service'

async function downloadImage(url) {
    try {
        const gotScraping = await import('got-scraping')
        const response = await gotScraping.got(url, { responseType: 'buffer' })

        // Check if the response status code indicates success (e.g., 200)
        if (response.statusCode === 200) {
            return Buffer.from(response.body).toString('base64')
        } else {
            console.error(`Failed to download image. Status code: ${response.statusCode}`)
            return null
        }
    } catch (error) {
        console.error(`Error downloading image: ${error.message}`)
        return null
    }
}
async function saveAdToPages(options) {
    const { pid, html, imageUrls } = options
    const octokit = new Octokit({
        auth: GITHUB_TOKEN,
    })
    const subdir = `${pid}`
    let modifiedHtml

    await mapSeries(imageUrls, async url => {
        const content = await downloadImage(url)
        const filenameBigImage = url.split('/').pop()
        const baseFilename = filenameBigImage.match(/(.*)(_\d{3,4}x\d{3,4}.jpg)/)[1]
        const path = `craigslist/${subdir}/${filenameBigImage}`

        modifiedHtml = (modifiedHtml || html).replaceAll(new RegExp(`href="https://images.craigslist.org/${baseFilename}.*.jpg"`, 'g'), `href="https://june07.github.io/jc-archive/craigslist/${subdir}/${filenameBigImage}"`)
        if (content) {
            await octokit.repos.createOrUpdateFileContents({
                owner: GITHUB_USER,
                repo: GITHUB_REPO,
                path,
                message: `Craigslist ad image archived via JC by June07`,
                content: content,
                committer: {
                    name: GITHUB_USER,
                    email: `support@${DOMAIN}`
                }
            })
        }
    })

    await octokit.repos.createOrUpdateFileContents({
        owner: GITHUB_USER,
        repo: GITHUB_REPO,
        path: `craigslist/${subdir}/index.htm`,
        message: `Craigslist ad archived via JC by June07`,
        content: Buffer.from(modifiedHtml).toString('base64'),
        committer: {
            name: GITHUB_USER,
            email: `support@${DOMAIN}`
        }
    })
    return `https://june07.github.io/jc-archive/craigslist/${subdir}/index.htm`
}
async function getCommentData(id) {
    const { got } = await import('got')
    const query = `
        query {
            search(type: DISCUSSION, last: 1, query: "repo:june07/jc-comments in:id:${id}") {
                nodes {
                    ... on Discussion {
                        title
                        comments {
                            totalCount
                        }
                    }
                }
            }
        }
    `
    const { error, data } = await got({
        method: 'POST',
        url: 'http://api.github.com/graphql',
        headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`
        },
        body: JSON.stringify({ query })
    }).json()
    if (error) {
        logger.error(error)
        return
    }
    return data?.search?.nodes?.[0]
}

module.exports = {
    saveAdToPages,
    getCommentData
}