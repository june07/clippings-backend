const debug = require('debug')('jc-backend:github:service'),
    { Octokit } = require("@octokit/rest")

const { GITHUB_USER, GITHUB_REPO, GITHUB_TOKEN, DOMAIN } = process.env

async function downloadImage(url) {
    try {
        const gotScraping = await import('got-scraping')
        const response = await gotScraping.got(url, { responseType: 'buffer' })

        // Check if the response status code indicates success (e.g., 200)
        if (response.statusCode === 200) {
            return response.body
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
    const { url, uuid, html, imageUrls } = options
    const octokit = new Octokit({
        auth: GITHUB_TOKEN,
    })

    const p1 = octokit.repos.createOrUpdateFileContents({
        owner: GITHUB_USER,
        repo: GITHUB_REPO,
        path: `craigslist/${uuid}/index.htm`,
        message: `Craigslist ad archived via JC by June07`,
        content: html,
        committer: {
            name: GITHUB_USER,
            email: `support@${DOMAIN}`
        }
    })

    await Promise.all([
        p1,
        ...imageUrls.map(url => new Promise(async resolve => {
            await octokit.repos.createOrUpdateFileContents({
                owner: GITHUB_USER,
                repo: GITHUB_REPO,
                path: `craigslist/${uuid}/${url.split('/').pop()}`,
                message: `Craigslist ad image archived via JC by June07`,
                content: await downloadImage(url),
                committer: {
                    name: GITHUB_USER,
                    email: `support@${DOMAIN}`
                }
            })
            resolve()
        }))
    ])
    return `https://june07.github.io/jc-archive/craigslist/${uuid}/index.htm`
}
async function getCommentData(id) {
    const { got } = await import('got')
    const query = `
        query {
            search(type: DISCUSSION, last: 1, query: "repo:june07/jc-comments in:id:${id}") {
                nodes {
                    ... on Discussion {
                        comments {
                            title
                            totalCount
                        }
                    }
                }
            }
        }
    `
    const { data } = await got({
        method: 'POST',
        url: 'http://api.github.com/graphql',
        headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`
        },
        body: JSON.stringify({ query })
    }).json()
    return data.search.nodes[0].comments
}

module.exports = {
    saveAdToPages,
    getCommentData
}