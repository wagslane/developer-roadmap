const fs = require('fs');
const path = require('path');

const OPEN_AI_API_KEY = process.env.OPEN_AI_API_KEY;
const ALL_ROADMAPS_DIR = path.join(__dirname, '../src/data/roadmaps');
const ROADMAP_JSON_DIR = path.join(__dirname, '../public/jsons/roadmaps');

const roadmapId = process.argv[2];

const allowedRoadmapIds = fs.readdirSync(ALL_ROADMAPS_DIR);
if (!roadmapId) {
  console.error('roadmapId is required');
  process.exit(1);
}

if (!allowedRoadmapIds.includes(roadmapId)) {
  console.error(`Invalid roadmap key ${roadmapId}`);
  console.error(`Allowed keys are ${allowedRoadmapIds.join(', ')}`);
  process.exit(1);
}

const ROADMAP_CONTENT_DIR = path.join(ALL_ROADMAPS_DIR, roadmapId, 'content');
const { Configuration, OpenAIApi } = require('openai');
const configuration = new Configuration({
  apiKey: OPEN_AI_API_KEY,
});

const openai = new OpenAIApi(configuration);

function getFilesInFolder(folderPath, fileList = {}) {
  const files = fs.readdirSync(folderPath);

  files.forEach((file) => {
    const filePath = path.join(folderPath, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      getFilesInFolder(filePath, fileList);
    } else if (stats.isFile()) {
      const fileUrl = filePath
        .replace(ROADMAP_CONTENT_DIR, '') // Remove the content folder
        .replace(/\/\d+-/g, '/') // Remove ordering info `/101-ecosystem`
        .replace(/\/index\.md$/, '') // Make the `/index.md` to become the parent folder only
        .replace(/\.md$/, ''); // Remove `.md` from the end of file

      fileList[fileUrl] = filePath;
    }
  });

  return fileList;
}

function writeTopicContent(currTopicUrl) {
  const [parentTopic, childTopic] = currTopicUrl
    .replace(/^\d+-/g, '/')
    .replace(/:/g, '/')
    .replace(/^\//, '')
    .split('/')
    .slice(-2)
    .map((topic) => topic.replace(/-/g, ' '));

  const roadmapTitle = roadmapId.replace(/-/g, ' ');

  let prompt = `I am reading a guide about "${roadmapTitle}". I am on the topic "${parentTopic}". I want to know more about "${childTopic}". Write me a brief summary for that topic. Content should be in markdown. Behave as if you are the author of the guide.`;
  if (!childTopic) {
    prompt = `I am reading a guide about "${roadmapTitle}". I am on the topic "${parentTopic}". I want to know more about "${parentTopic}". Write me a brief summary for that topic. Content should be in markdown. Behave as if you are the author of the guide.`;
  }

  console.log(`Genearting '${childTopic || parentTopic}'...`);

  return new Promise((resolve, reject) => {
    openai
      .createChatCompletion({
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      })
      .then((response) => {
        const article = response.data.choices[0].message.content;

        resolve(article);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

async function run() {
  const topicUrlToPathMapping = getFilesInFolder(ROADMAP_CONTENT_DIR);

  const roadmapJson = require(path.join(ROADMAP_JSON_DIR, `${roadmapId}.json`));
  const groups = roadmapJson?.mockup?.controls?.control?.filter(
    (control) => control.typeID === '__group__' && !control.properties?.controlName?.startsWith('ext_link')
  );

  if (!OPEN_AI_API_KEY) {
    console.log('----------------------------------------');
    console.log('OPEN_AI_API_KEY not found. Skipping openai api calls...');
    console.log('----------------------------------------');
  }

  for (let group of groups) {
    const topicId = group?.properties?.controlName;
    const topicTitle = group?.children?.controls?.control?.find((control) => control?.typeID === 'Label')?.properties
      ?.text;
    const currTopicUrl = topicId.replace(/^\d+-/g, '/').replace(/:/g, '/');
    const contentFilePath = topicUrlToPathMapping[currTopicUrl];

    if (!contentFilePath) {
      console.log(`Missing file for: ${currTopicUrl}`);
      return;
    }

    const currentFileContent = fs.readFileSync(contentFilePath, 'utf8');
    const isFileEmpty = currentFileContent.replace(/^#.+/, ``).trim() === '';

    if (!isFileEmpty) {
      console.log(`Ignoring ${topicId}. Not empty.`);
      continue;
    }

    let newFileContent = `# ${topicTitle}`;

    if (!OPEN_AI_API_KEY) {
      console.log(`Writing ${topicId}..`);
      fs.writeFileSync(contentFilePath, newFileContent, 'utf8');
      continue;
    }

    const topicContent = await writeTopicContent(currTopicUrl);
    newFileContent += `\n\n${topicContent}`;

    console.log(`Writing ${topicId}..`);
    fs.writeFileSync(contentFilePath, newFileContent, 'utf8');

    // console.log(currentFileContent);
    // console.log(currTopicUrl);
    // console.log(topicTitle);
    // console.log(topicUrlToPathMapping[currTopicUrl]);
  }
}

run()
  .then(() => {
    console.log('Done');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
