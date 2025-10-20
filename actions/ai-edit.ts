"use server";

import Groq from "groq-sdk";

import { AIMindmap } from "@/types/AI";

const SYSTEM_PROMPT = `
You are a mindmap generator. Your task to create and edit mindmaps based on user input prompts. Your response
should be concise and to the point. You should search the web for the most relevant information to the user prompt, 
and also use your own knowledge to create a mindmap that is relevant to the user prompt. Also, you should add citations
and references to the sources you used to create the mindmap.

You should not add any other text to your response. You should only return the mindmap in the format of a JSON array of objects. Each object should have the following properties: "nodeId", "title", "description", "link", "childrenNodes".

Create atleast 4-5 levels deep, and upto 10 levels deep, with each item branching into max 3 items, except the root. The root should always have atleast 4 children to maintain a good structure and visual appeal. Your goal is to create a deep structure, and NOT a flat one. You should generate minimum of 50 total nodes. 

Do not hesitate to stop early and provide as much information as possible. 
This is REALLY IMPORTANT. The mindmap should not  feel incomplete to the user. 

The following is an example of a mindmap, and you should strictly follow the same format.

\`\`\`json
{
  "mindmap": [
    {
      "nodeId": "root",
      "title": "title",
      "description": "brief descriptiona, helping the title",
      "link": "optional reference link",
      "childrenNodes": ["child1", "child2", "child3"]
    },
    {
      "nodeId": "child1",
      "title": "child1 title",
      "description": "child1 description",
      "link": "optional reference link"
    },
    {
      "nodeId": "child2",
      "title": "child2 title",
      "description": "child2 description",
      "link": "optional reference link"
    }
    ...
  ]
}

I shall give you a branch of the current mindmap for your context. You should add nodes to the branch and return the new nodes only. Try to maintain the existing structure and hierarchy of the mindmap, and your changes should only reflect in the new nodes.

You should focus on adding atleast 2 levels of new information when editing the mindmap. But do not add more than 4 levels of new information.
\`\`\`
`;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function editAIMindmap(
  userPrompt: string,
  currentBranch: AIMindmap[] = [],
  activeNodeId: string
) {
  if (!userPrompt) {
    throw new Error("User prompt is required");
  }

  if (currentBranch.length === 0) {
    throw new Error("Current branch is required");
  }

  const aiResponse = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: userPrompt,
      },
      {
        role: "user",
        content: `Current branch: ${JSON.stringify(currentBranch)}. You need to add content to the active node: ${activeNodeId}`,
      },
    ],
    model: "llama-3.3-70b-versatile",
    response_format: { type: "json_object" },
    max_completion_tokens: 10000,
  });

  let mindmap = [] as AIMindmap[];
  try {
    // eslint-disable-next-line no-console -- needed for logging
    console.log(
      "new mindmap nodes from ai:",
      aiResponse.choices[0].message.content
    );

    const json = JSON.parse(aiResponse.choices[0].message.content ?? "{}") as {
      mindmap?: AIMindmap[];
    };
    mindmap = json.mindmap ?? [];
  } catch (err) {
    // eslint-disable-next-line no-console -- needed for logging
    console.error(err);
  }

  return {
    rawOutput: aiResponse,
    mindmap: mindmap,
  };
}
