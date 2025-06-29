"use server";

import Groq from "groq-sdk";

import { AIMindmap } from "@/types/AI";

// const SAMPLE_DATA = [
//   {
//     nodeId: "root",
//     title: "Events Leading to World War I",
//     description: "Complex set of geopolitical events and alliances",
//     link: "https://en.wikipedia.org/wiki/Events_leading_to_World_War_I",
//     childrenNodes: ["imperialism", "militarism", "alliances"],
//   },
//   {
//     nodeId: "imperialism",
//     title: "Imperialism",
//     description: "Competition for colonies and resources",
//     link: "https://en.wikipedia.org/wiki/Imperialism",
//     childrenNodes: [
//       "scramble_for_africa",
//       "european_colonization",
//       "ottoman_decline",
//     ],
//   },
//   {
//     nodeId: "scramble_for_africa",
//     title: "Scramble for Africa",
//     description: "European powers competing for African territories",
//     link: "https://en.wikipedia.org/wiki/Scramble_for_Africa",
//     childrenNodes: ["berlin_conference", "congo_free_state", "boer_wars"],
//   },
//   {
//     nodeId: "berlin_conference",
//     title: "Berlin Conference",
//     description: "European powers dividing Africa among themselves",
//     link: "https://en.wikipedia.org/wiki/Berlin_Conference",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "congo_free_state",
//     title: "Congo Free State",
//     description: "King Leopold's brutal regime in the Congo",
//     link: "https://en.wikipedia.org/wiki/Congo_Free_State",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "boer_wars",
//     title: "Boer Wars",
//     description: "British conflicts with Dutch settlers in South Africa",
//     link: "https://en.wikipedia.org/wiki/Boer_Wars",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "european_colonization",
//     title: "European Colonization",
//     description:
//       "European powers competing for territories in Asia and the Pacific",
//     link: "https://en.wikipedia.org/wiki/Colonization",
//     childrenNodes: ["boxer_rebellion", "opium_wars", "french_indochina"],
//   },
//   {
//     nodeId: "boxer_rebellion",
//     title: "Boxer Rebellion",
//     description: "Anti-foreigner uprising in China",
//     link: "https://en.wikipedia.org/wiki/Boxer_Rebellion",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "opium_wars",
//     title: "Opium Wars",
//     description: "British conflicts with China over trade and territory",
//     link: "https://en.wikipedia.org/wiki/Opium_Wars",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "french_indochina",
//     title: "French Indochina",
//     description: "French colonization of Southeast Asia",
//     link: "https://en.wikipedia.org/wiki/French_Indochina",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "ottoman_decline",
//     title: "Ottoman Decline",
//     description: "Decline of the Ottoman Empire and its territories",
//     link: "https://en.wikipedia.org/wiki/Decline_of_the_Ottoman_Empire",
//     childrenNodes: ["balkan_wars", "ottoman_reform", "arab_nationalism"],
//   },
//   {
//     nodeId: "balkan_wars",
//     title: "Balkan Wars",
//     description: "Conflicts in the Balkans over Ottoman territories",
//     link: "https://en.wikipedia.org/wiki/Balkan_Wars",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "ottoman_reform",
//     title: "Ottoman Reform",
//     description: "Efforts to modernize and reform the Ottoman Empire",
//     link: "https://en.wikipedia.org/wiki/Ottoman_reform",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "arab_nationalism",
//     title: "Arab Nationalism",
//     description: "Rise of Arab nationalism and resistance to Ottoman rule",
//     link: "https://en.wikipedia.org/wiki/Arab_nationalism",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "militarism",
//     title: "Militarism",
//     description: "Build-up of military forces and aggressive posturing",
//     link: "https://en.wikipedia.org/wiki/Militarism",
//     childrenNodes: [
//       "naval_rivalry",
//       "german_militarism",
//       "austro_hungarian_militarism",
//     ],
//   },
//   {
//     nodeId: "naval_rivalry",
//     title: "Naval Rivalry",
//     description: "Competition for naval supremacy between European powers",
//     link: "https://en.wikipedia.org/wiki/Anglo-German_naval_rivalry",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "german_militarism",
//     title: "German Militarism",
//     description: "Rise of German military power and aggressive posturing",
//     link: "https://en.wikipedia.org/wiki/German_militarism",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "austro_hungarian_militarism",
//     title: "Austro-Hungarian Militarism",
//     description:
//       "Rise of Austro-Hungarian military power and aggressive posturing",
//     link: "https://en.wikipedia.org/wiki/Austro-Hungarian_Army",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "alliances",
//     title: "Alliances",
//     description: "Complex system of alliances between European powers",
//     link: "https://en.wikipedia.org/wiki/Triple_Entente",
//     childrenNodes: ["triple_entente", "triple_alliance", "balkan_league"],
//   },
//   {
//     nodeId: "triple_entente",
//     title: "Triple Entente",
//     description: "Alliance between France, Britain, and Russia",
//     link: "https://en.wikipedia.org/wiki/Triple_Entente",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "triple_alliance",
//     title: "Triple Alliance",
//     description: "Alliance between Germany, Austria-Hungary, and Italy",
//     link: "https://en.wikipedia.org/wiki/Triple_Alliance_(1882)",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "balkan_league",
//     title: "Balkan League",
//     description: "Alliance between Balkan states against the Ottoman Empire",
//     link: "https://en.wikipedia.org/wiki/Balkan_League",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "key_leaders",
//     title: "Key Leaders",
//     description:
//       "Important world leaders who played a role in the events leading to World War I",
//     link: "",
//     childrenNodes: [
//       "kaiser_wilhelm",
//       "franz_ferdinand",
//       "woodrow_wilson",
//       "george_v",
//       "nicolas_ii",
//     ],
//   },
//   {
//     nodeId: "kaiser_wilhelm",
//     title: "Kaiser Wilhelm II",
//     description: "German Emperor and King of Prussia",
//     link: "https://en.wikipedia.org/wiki/Wilhelm_II,_German_Emperor",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "franz_ferdinand",
//     title: "Archduke Franz Ferdinand",
//     description:
//       "Austro-Hungarian archduke whose assassination sparked World War I",
//     link: "https://en.wikipedia.org/wiki/Archduke_Franz_Ferdinand_of_Austria",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "woodrow_wilson",
//     title: "Woodrow Wilson",
//     description: "President of the United States during World War I",
//     link: "https://en.wikipedia.org/wiki/Woodrow_Wilson",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "george_v",
//     title: "George V",
//     description: "King of the United Kingdom during World War I",
//     link: "https://en.wikipedia.org/wiki/George_V",
//     childrenNodes: [],
//   },
//   {
//     nodeId: "nicolas_ii",
//     title: "Nicholas II",
//     description: "Russian Tsar during World War I",
//     link: "https://en.wikipedia.org/wiki/Nicholas_II_of_Russia",
//     childrenNodes: [],
//   },
// ];

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
\`\`\`
`;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function generateAIMindmap(userPrompt: string) {
  if (!userPrompt) {
    throw new Error("User prompt is required");
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
    ],
    // model: "llama-3.3-70b-versatile",
    // model: "mistral-saba-24b",
    // model: "meta-llama/llama-prompt-guard-2-86m",
    model: "deepseek-r1-distill-llama-70b",
    response_format: { type: "json_object" },
    max_completion_tokens: 3000,
  });

  // console.log(aiResponse);

  let mindmap = [] as AIMindmap[];
  try {
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
