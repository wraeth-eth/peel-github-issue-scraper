const fs = require("fs");
const dotenv = require("dotenv");
const { Octokit } = require("@octokit/core");
const { Client } = require("@notionhq/client");
const { markdownToBlocks, markdownToRichText } = require("@tryfabric/martian");

dotenv.config();

const octokit = new Octokit(
  process.env.GITHUB_API_KEY ? { auth: process.env.GITHUB_API_KEY } : {}
);
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DB_ID;

const getGitHubIssuesData = async () => {
  let results = [];
  let page = 1;
  while (true) {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/issues", {
      owner: "jbx-protocol",
      repo: "juice-interface",
      state: "open",
      per_page: 100,
      page,
    });
    page++;
    if (data.length === 0) {
      break;
    }
    results.push(...data);
  }

  return results.filter((issue) => !issue.pull_request);
};

(async () => {
  const results = await getGitHubIssuesData();
  let newResults = await Promise.all(
    results.map(async (issue) => {
      if (issue.comments) {
        const comments = await octokit.request(
          "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
          {
            owner: "jbx-protocol",
            repo: "juice-interface",
            issue_number: issue.number,
          }
        );
        issue.comments = comments.data.map((comment) => ({
          body: comment.body,
          user: comment.user.login,
          url: comment.html_url,
        }));
      }
      return issue;
    })
  );

  newResults = newResults.map((issue) => ({
    url: issue.html_url,
    title: issue.title,
    number: issue.number,
    creator: issue.user.login,
    assignees: issue.assignees?.length
      ? issue.assignees.map((assignee) => assignee.login)
      : null,
    labels: issue.labels.map((label) => label.name),
    comments: issue.comments,
    body: issue.body,
    created_at: issue.created_at,
  }));

  fs.writeFileSync("issues.json", JSON.stringify(newResults, null, 2));

  const tags = newResults.reduce((acc, issue) => {
    issue.labels.forEach((label) => {
      if (!acc.includes(label)) {
        acc.push(label);
      }
    });
    return acc;
  }, []);
  console.log(tags);

  const assignees = newResults.reduce((acc, issue) => {
    issue.assignees?.forEach((assignee) => {
      if (!acc.includes(assignee)) {
        acc.push(assignee);
      }
    });
    return acc;
  }, []);

  const creators = newResults.reduce((acc, issue) => {
    if (!acc.includes(issue.creator)) {
      acc.push(issue.creator);
    }
    return acc;
  }, []);

  const availableColors = [
    "gray",
    "brown",
    "orange",
    "yellow",
    "green",
    "blue",
    "purple",
    "pink",
    "red",
  ];
  await notion.databases.update({
    database_id: databaseId,
    properties: {
      GitHub_Labels: {
        multi_select: {
          options: tags.map((tag, i) => ({
            name: tag,
            // Make each tag a unique color
            color: availableColors[i % availableColors.length],
          })),
        },
      },
      GitHub_CreatedAt: {
        date: {},
      },
      GitHub_URL: {
        url: {},
      },
      GitHub_Creator: {
        multi_select: {
          options: creators.map((creator, i) => ({
            name: creator,
            color: availableColors[i % availableColors.length],
          })),
        },
      },
      GitHub_Assignees: {
        multi_select: {
          options: assignees.map((assignee, i) => ({
            name: assignee,
            color: availableColors[i % availableColors.length],
          })),
        },
      },
    },
  });

  await Promise.all(
    newResults.map(async (issue) => {
      const page = await notion.pages.create({
        parent: {
          database_id: databaseId,
        },
        children: [
          ...(issue.body ? markdownToBlocks(issue.body) : []),
          {
            object: "block",
            heading_2: {
              rich_text: [
                {
                  text: {
                    content: "Comments",
                  },
                },
              ],
            },
          },
          ...(issue.comments
            ? issue.comments.map((comment) => ({
                object: "block",
                paragraph: {
                  rich_text: [
                    {
                      text: {
                        content: `@${comment.user}: ${comment.body}\n${comment.url}`,
                      },
                    },
                  ],
                },
              }))
            : []),
        ],
        properties: {
          // Assign: {
          //   person: {

          //   }
          // }
          GitHub_URL: {
            url: issue.url,
          },
          GitHub_CreatedAt: {
            date: {
              start: issue.created_at,
            },
          },
          //   GitHub_CreatedAt: {
          //     ...(issue.created_at
          //       ? {
          //           date: {
          //             start: issue.created_at,
          //           },
          //         }
          //       : { date: null }),
          //   },
          GitHub_Creator: {
            multi_select: [
              {
                name: issue.creator,
              },
            ],
          },
          GitHub_Assignees: {
            multi_select: issue.assignees
              ? issue.assignees.map((assignee) => ({
                  name: assignee,
                }))
              : [],
          },
          GitHub_Labels: {
            multi_select: issue.labels.map((label) => ({
              name: label,
            })),
          },
          Name: {
            title: [
              {
                text: {
                  content: issue.title,
                },
              },
            ],
          },
        },
      });
    })
  );
})();
