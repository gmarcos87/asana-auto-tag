const asana = require("asana");
const express = require("express");
const dotenv = require("dotenv");

// Arguments / constants
dotenv.config();
const accessToken = process.env.ACCESS_TOKEN;
const workspace = process.env.WORKPLACE;
const teamId = process.env.TEAM;
const backlogId = process.env.BACKLOG;
const projectCustomFieldId = process.env.PROJECT_CUSTOM_FILED;
const webhookUrl = process.env.WEBHOOK_URL;

// Set up a Asana client using personal access token
const client = asana.Client.create().useAccessToken(accessToken);

// Customs Asana functions
const findOrCreateProjectCustomField = async (name, color) => {
  const customFields = await client.customFields.getCustomField(projectCustomFieldId, {param: "value", param: "value", opt_pretty: true})
  const option = customFields.enum_options.find(option => option.name === name)
  if(!option) {
    const created = await client.customFields.createEnumOptionForCustomField(projectCustomFieldId, {
      name: name,
      enabled: true,
    })
    return created;
  }
  return option;
};

const addProyectTagToTasks = async ({ action, resource, parent }) => {
  if (
    action !== "added" ||
    resource.resource_type !== "task" ||
    parent.resource_type !== "section"
  )
    return;
  try {
    const task = await client.tasks.findById(resource.gid);
    if (task.projects[0].name !== 'Current Run' || !task.projects[1]  ) return
    const taskProjectCustomField = task.custom_fields.find(customField => customField.gid === projectCustomFieldId)
    if(taskProjectCustomField && taskProjectCustomField.display_value !== null ) return
  
    const project = await client.projects.findById(task.projects[1].gid)
    console.log(`Project ${project.name} get a new task`)

    const option = await findOrCreateProjectCustomField(project.name, project.color);

    await client.tasks.update(resource.gid, { custom_fields: {[projectCustomFieldId]: option.gid }})
    console.log(`Custom field  ${option.name} added to ${task.name}`);
  } catch (e) {
    console.warn("Error adding the custom field to " + resource.gid, e);
  }
};

const addWebhooksToNewProjects = async ({ action, resource }) => {
  if (action !== "added" || resource.resource_type !== "project") return;
  try {
    await addOrUpdateWebHook(resource.gid);
    console.log(`New project (${resource.gid}) added`);
  } catch (e) {
    console.warn("Error listening the new project " + resource.gid);
  }
};

const addNewTasksToBacklog = async ({ action, resource, parent }) => {
  if (
    action !== "added" ||
    resource.resource_type !== "task" ||
    parent.resource_type !== "section"
  )
    return;
  const currentSection = await client.sections.findById(parent.gid);

  // Only tasks added to Top Priority sections
  if (currentSection.name.toLowerCase() !== 'top priority') return

  // But not this Top Priority sections
  const toIgnore = ['1156081171852558']
  if (toIgnore.indexOf(currentSection.gid) !== -1) return

  await client.sections.addTask(backlogId, { task: resource.gid });
};

const addOrUpdateWebHook = async (gid, actualHook, options) => {
  if (actualHook) await client.webhooks.deleteById(actualHook.gid);
  await client.webhooks.create(gid, webhookUrl, options);
};

const checkWebhooks = async () => {
  try {
    const { data: hooks } = await client.webhooks.getAll(workspace);
    const { data: projects } = await client.projects.findByWorkspace(workspace);

    projects.reduce(async (_, project) => {
      const proyectHook = hooks.find(
        (hook) => hook.resource.gid === project.gid
      );
      if (proyectHook && proyectHook.target === webhookUrl) return;
      await addOrUpdateWebHook(project.gid, proyectHook);
    }, []);

    checkProyectCreationHook(hooks);
  } catch (error) {
    console.error("Error: ", error.value.errors);
  }
};

const checkProyectCreationHook = async (hooks) => {
  try {
    const hook = hooks.find((hook) => hook.resource.gid === teamId);
    if (hook && hook.target === webhookUrl) return;
    await addOrUpdateWebHook(teamId, hook, {
      filters: [{ resource_type: "project", action: "added" }],
    });
  } catch (e) {
    // Ignore any error here
  }
};

// Set up express
const app = express();
app.use(express.json());
app.use(express.static("public"));

app.post("/", function (req, res) {
  // Handle hook registration
  if (req.headers["x-hook-secret"]) {
    const xHookSecret = req.headers["x-hook-secret"];
    res.setHeader("x-hook-secret", xHookSecret);
    res.send();
    return;
  }

  // Handle asana events
  if (req.body.events) {
    res.send();
    req.body.events.reduce(async (_, event) => {
      // List of actions
       await addProyectTagToTasks(event);
       await addWebhooksToNewProjects(event);
       await addNewTasksToBacklog(event)
    }, []);
  }
});

const cleanHooks = async () => {
  const { data: hooks } = await client.webhooks.getAll(workspace);
  hooks.reduce(
    async (_, hook) => await client.webhooks.deleteById(hook.gid),
    []
  );
};

// Start the web server and publish the service
app.listen(process.env.PORT || 3000, () => console.log("Server is running..."));
checkWebhooks();
//cleanHooks();