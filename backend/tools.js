// The fixed "menu" of actions our voice assistant can perform.
// The LLM picks ONE of these and fills in the fields it can hear in the sentence.
// Anything it's unsure about, it should leave out (as null) rather than guess.
//
// Note: optional fields use `anyOf: [{type:'string'}, {type:'null'}]` instead of
// a plain `type: 'string'`. Groq's tool-calling frequently sends explicit `null`
// for "nothing to fill in here" rather than omitting the key, and a plain
// `type: 'string'` schema rejects that as invalid. This anyOf form is the
// widely-compatible way to say "string OR null are both fine".

const tools = [
  {
    type: 'function',
    function: {
      name: 'create_task',
      description:
        'Create a BRAND NEW task/snag/issue for a project. Use this only when logging something that does not already exist yet. If the user is referring to an existing task (e.g. "this task", "that issue") and wants to change or add details to it, use the appropriate update tool instead (set_task_location, update_status, assign_task), not this one.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'What the issue/task is, in a short phrase, e.g. "cracked tile", "leaking pipe".'
          },
          location: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Where in the project this applies, e.g. "master bathroom ceiling", "kitchen". Leave null if not mentioned.'
          },
          project_name: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'The project this task belongs to, if mentioned. Leave null if not mentioned.'
          },
          assignee_hint: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description:
              'Free-text description of who this should be assigned to, as the user said it, e.g. "false-ceiling contractor". Leave null if not mentioned.'
          },
          estimated_cost: {
            anyOf: [{ type: 'number' }, { type: 'null' }],
            description: 'Estimated cost if an amount was mentioned. Convert shorthand like "35k" to 35000, "2 lakh" to 200000. Leave null if not mentioned.'
          },
          assigned_date: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'The date this task is being assigned/logged, if mentioned (e.g. "assigned today", "starting Monday"). Convert to an ISO date YYYY-MM-DD using today\'s date as reference. Leave null if not mentioned.'
          },
          completion_deadline: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'The deadline by which this task should be completed, if mentioned (e.g. "by next Friday", "due in two weeks"). Convert to an ISO date YYYY-MM-DD using today\'s date as reference. Leave null if not mentioned.'
          }
        },
        required: ['description']
      }
    }
  },
  {
  type: 'function',
  function: {
    name: 'add_location',
    description: 'Add a new location/area to a project before any tasks exist there yet - e.g. "add a rooftop to Sunrise Villa", "create a location called terrace garden". Use this to set up a location in advance, not for tagging a task\'s location (that happens automatically via create_task/set_task_location).',
    parameters: {
      type: 'object',
      properties: {
        project_name: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Which project. Leave null to use the most recently discussed project.' },
        location_name: { type: 'string', description: 'The name of the location/area to add.' },
        estimated_cost: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'A budget for this location if mentioned. Leave null if not mentioned.' }
      },
      required: ['location_name']
    }
  }
},
{
  type: 'function',
  function: {
    name: 'upload_image',
    description: 'Bring up a picture upload control for a project or a specific location within it - use for "upload a picture to X", "add a photo of the rooftop for X", "add a picture of the front gate". Doesn\'t upload anything itself (a file has to be picked on-device) - just identifies where the picture belongs.',
    parameters: {
      type: 'object',
      properties: {
        project_name: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Which project. Leave null to use the most recently discussed project.' },
        location_reference: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Which location/area within the project, if this picture is for a specific location rather than the project overall (e.g. "rooftop", "main gate"). Leave null for a general project picture.' },
        label: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'A short label for what the picture shows, e.g. "front view of main gate". Leave null if not described.' }
      },
      required: []
    }
  }
},
  {
    type: 'function',
    function: {
      name: 'set_task_location',
      description: 'Update the location of an EXISTING task. Use this when the user wants to add or change WHERE an already-created task applies, e.g. "add location first floor room to this task", "move that task to the kitchen". Do NOT use create_task for this - no new task should be made.',
      parameters: {
        type: 'object',
        properties: {
          task_reference: {
            type: 'string',
            description: 'How the user referred to the task. Use "it"/"this task" if referring back to the most recently discussed task.'
          },
          location: {
            type: 'string',
            description: 'The new location, e.g. "first floor room".'
          }
        },
        required: ['task_reference', 'location']
      }
    }
  },

  {
    type: 'function',
    function: {
      name: 'assign_task',
      description:
        'Assign an EXISTING task to a contractor/person. Use this when the user refers to a task that likely already exists and wants to (re)assign it.',
      parameters: {
        type: 'object',
        properties: {
          task_reference: {
            type: 'string',
            description:
              'The exact words the user used to describe which task, e.g. "the ceiling crack task", "task 2", or "it"/"that task" if referring back to the most recently discussed task.'
          },
          assignee_hint: {
            type: 'string',
            description: 'Free-text description of who to assign it to, as the user said it.'
          },
          assigned_date: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'The date this assignment starts, if mentioned. Convert to an ISO date YYYY-MM-DD using today\'s date as reference. Leave null if not mentioned.'
          }
        },
        required: ['task_reference', 'assignee_hint']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description:
        'Permanently delete/remove an existing task or snag. Use this only when the user explicitly asks to delete, remove, or discard a task.',
      parameters: {
        type: 'object',
        properties: {
          task_reference: {
            type: 'string',
            description:
              'The exact words the user used to describe which task to delete - copy their description/location phrase as closely as possible, e.g. "the leaking pipe task". Do not shorten this to just "the task". Use "it"/"that task" if referring back to the most recently discussed task.'
          }
        },
        required: ['task_reference']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_expense',
      description: 'Record money spent on an EXISTING task, adding to its running spent cost. Use this when the user reports an actual expense, e.g. "log 5000 spent on the plumbing task", "we spent 2 lakh on the ceiling work so far".',
      parameters: {
        type: 'object',
        properties: {
          task_reference: {
            type: 'string',
            description: 'How the user referred to the task. Use "it"/"this task" if referring back to the most recently discussed task.'
          },
          amount: {
            type: 'number',
            description: 'The amount spent, to add to the task\'s running total. Convert shorthand like "35k" to 35000, "2 lakh" to 200000.'
          }
        },
        required: ['task_reference', 'amount']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_status',
      description:
        'Change the status of an existing task, e.g. mark it complete, in progress, or reopen it.',
      parameters: {
        type: 'object',
        properties: {
          task_reference: {
            type: 'string',
            description: 'How the user referred to the task. Use "it"/"that task" if referring back to the most recently discussed task.'
          },
          new_status: {
            type: 'string',
            description: 'The new status: "open", "in_progress", or "done".'
          }
        },
        required: ['task_reference', 'new_status']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_tasks',
      description:
  'Search/list MULTIPLE tasks matching some filter (status, contractor, project, location). Use this for plural/filtering questions like "show me open tasks", "what tasks are assigned to plumbing". Do NOT use this if the user is asking about ONE specific task they already referred to (e.g. "its details", "this task", "that one") - use get_progress_report for that instead.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Filter by status if mentioned: "open", "in_progress", or "done". Leave null if not mentioned.'
          },
          assignee_hint: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Filter by assignee/contractor if mentioned, as free text.'
          },
          project_name: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Filter by project name if mentioned.'
          },
          location: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Filter by location/keyword in description if mentioned.'
          },
          created_on: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Filter by creation date if mentioned (e.g. "created today", "logged last week"). Convert to an ISO date YYYY-MM-DD using today\'s date as reference. Leave null if not mentioned.'
          },
          completion_deadline: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Filter by completion deadline if mentioned (e.g. "due next Friday", "due in two weeks"). Convert to an ISO date YYYY-MM-DD using today\'s date as reference. Leave null if not mentioned.'
          }
        },
        required: []
     }
    }
  },
  {
  type: 'function',
  function: {
    name: 'set_task_notes',
    description: 'Add or update the notes/specification on an EXISTING task - e.g. a paint color, material choice, design detail. Use this when the user wants to add extra detail to a task that already exists, not create a new one.',
    parameters: {
      type: 'object',
      properties: {
        task_reference: {
          type: 'string',
          description: 'How the user referred to the task. Use "it"/"this task" if referring back to the most recently discussed task.'
        },
        notes: {
          type: 'string',
          description: 'The note/specification to record.'
        }
      },
      required: ['task_reference', 'notes']
    }
  }
},
  {
    type: 'function',
    function: {
      name: 'get_progress_report',
      description:
  'Get a progress report or details about a project or ONE SPECIFIC task: percent complete, task counts, cost vs budget (profit or loss), deadlines. Use this for "show me its details","is this project going in profit or loss", "give me details of this task", "how is X project going", "is this project in profit or loss". If the user says "it"/"its"/"this task/this project" referring to something already discussed, this is almost always the right tool for details of tasks and projects but when the mention of location is there like ("show the location of this task")("open this locaton") - then use the get_location_detail or location_list as per the command',
      parameters: {
        type: 'object',
        properties: {
          task_reference: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: "If asking about ONE specific task or project, how the user referred to it - use \"it\"/\"this task\"/\"its\"/\"this project\" if referring back to the most recently discussed task or project. Leave null only for a project-wide or system-wide summary instead."
          },
          project_name: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'If asking for a summary scoped to one project, the project name. Leave null for all projects.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_contractor_details',
      description:
        'Get details about contractor(s): how many tasks they are assigned, how many are done vs pending, their contract amount and contract period. If a specific contractor is named, give their details; if none is named (e.g. "show me all contractors"), list a summary of every contractor.',
      parameters: {
        type: 'object',
        properties: {
          contractor_reference: {
  anyOf: [{ type: 'string' }, { type: 'null' }],
  description: 'Which contractor, as the user described them, e.g. "the plumbing contractor". If the user uses a pronoun like "this contractor", "him", "her", "them", put that exact word here - do not leave it null. Only leave this null if the user explicitly wants ALL contractors listed (e.g. "show me all contractors").'
}
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: 'Create a brand new project.',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: 'The name of the new project.' },
          estimated_cost: {
            anyOf: [{ type: 'number' }, { type: 'null' }],
            description: 'Overall budget if mentioned. Convert shorthand like "35k" to 35000. Leave null if not mentioned.'
          },
          description: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'A short description of the project if the user gave one. Leave null if not mentioned.'
          },
          completion_deadline: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'The deadline by which the whole project should be completed, if mentioned. Convert to an ISO date YYYY-MM-DD using today\'s date as reference. Leave null if not mentioned.'
          }
        },
        required: ['project_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_task_deadline',
      description: 'Set or update the completion deadline of an EXISTING task. Use this when the user wants to add or change WHEN a task is due, e.g. "set the deadline for this task to next Friday", "that task is due in two weeks".',
      parameters: {
        type: 'object',
        properties: {
          task_reference: {
            type: 'string',
            description: 'How the user referred to the task. Use "it"/"this task" if referring back to the most recently discussed task.'
          },
          completion_deadline: {
            type: 'string',
            description: 'The new deadline. Convert to an ISO date YYYY-MM-DD using today\'s date as reference.'
          }
        },
        required: ['task_reference', 'completion_deadline']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_project_deadline',
      description: 'Set or update the overall completion deadline for a project. Use this when the user wants the whole project to have (or change) a target finish date.',
      parameters: {
        type: 'object',
        properties: {
          project_name: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Which project. Leave null to use the most recently discussed project.'
          },
          completion_deadline: {
            type: 'string',
            description: 'The new deadline. Convert to an ISO date YYYY-MM-DD using today\'s date as reference.'
          }
        },
        required: ['completion_deadline']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_projects',
      description: 'List all projects that exist, with a short summary of each one (progress, budget, spend). Use this when the user asks to see/show/list all projects or asks what projects exist. Do NOT use this for details on one specific named project - use get_progress_report or open_project for that instead.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
  type: 'function',
  function: {
    name: 'list_locations',
    description: 'List all locations/areas within a project, each with a short summary (task count, percent complete, cost). Use this when the user asks to see/show/list all locations or areas in a project, e.g. "show me all locations in Sunrise Villa", "what areas are in this project". Do NOT use this for a full project overview - use get_progress_report or open_project for that instead. Do NOT use this for details on ONE specific location - use get_location_details for that.',
    parameters: {
      type: 'object',
      properties: {
        project_name: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'Which project. If the user says "this project"/"it" or doesn\'t name one, leave null - the system will use whichever project is currently open.'
        }
      },
      required: []
    }
  }
},
  {
    type: 'function',
    function: {
      name: 'get_location_details',
      description:
  'Use this whenever the user asks WHERE something is, or asks about a LOCATION/AREA specifically - including "show me the location of this task", "where is this task", "what area is this in". Also use this for direct location questions like "give me details on the kitchen". Do NOT use get_progress_report for "location of" or "where is" questions - always use this tool for those.',
      parameters: {
        type: 'object',
        properties: {
          location_reference: {
  anyOf: [{ type: 'string' }, { type: 'null' }],
  description: 'The location/area by name, e.g. "kitchen". This must be null whenever a pronoun like "this task"/"it" is used instead - in that case put the pronoun in task_reference only, never here.'
},
           task_reference: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'If the user is asking about the location OF a specific task (e.g. "show me the location of this task"), how they referred to that task - use "it"/"this task/its" if referring back to the most recently discussed task. Leave null if a location was named directly instead.'
        },
          project_name: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Project to scope the search to, if mentioned. Leave null to search across all projects.'
          }
        },
        required: ['location_reference']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_project',
      description: 'Open/switch focus to a specific project and show its full details - description, progress, cost, and a breakdown of each location within it. Use this when the user says "open project X", "switch to X", "let\'s work on X".',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: 'The project to open.' }
        },
        required: ['project_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_project_description',
      description: 'Set or update a project\'s description. Use this when the user explicitly wants to describe what a project is about.',
      parameters: {
        type: 'object',
        properties: {
          project_name: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Which project. Leave null to use the most recently discussed project.'
          },
          description: { type: 'string', description: 'The description text.' }
        },
        required: ['description']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_project_expense',
      description: 'Record a general/overhead expense against a PROJECT as a whole, NOT tied to any specific task - e.g. permits, site security, miscellaneous costs. Use this when the user says "add 5000 to the spend for this project" and does not mention a specific task.',
      parameters: {
        type: 'object',
        properties: {
          project_name: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Which project. Leave null for "this project"/"it" - uses whichever is currently open.'
          },
          amount: {
            type: 'number',
            description: 'The amount spent. Convert shorthand like "35k" to 35000, "2 lakh" to 200000.'
          }
        },
        required: ['amount']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_project_budget',
      description: 'Set or update the overall budget/estimated cost for a project. Use this when the user says something like "set the budget for X to 500000" or "the budget for this project is 2 lakh".',
      parameters: {
        type: 'object',
        properties: {
          project_name: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Which project, if a specific name was said. Leave null if the user says "this project"/"it" - the system will use whichever project is currently open.'
          },
          amount: {
            type: 'number',
            description: 'The budget amount. Convert shorthand like "35k" to 35000, "2 lakh" to 200000.'
          }
        },
        required: ['amount']
      }
    }
  },
  {
  type: 'function',
  function: {
    name: 'rename_project',
    description: 'Rename an existing project to a new name. Use for e.g. "rename Sunrise Villa to Sunrise Towers", "change the project name to Greenfield Phase 2".',
    parameters: {
      type: 'object',
      properties: {
        project_name: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'The CURRENT name of the project to rename. Leave null to use the most recently discussed project.'
        },
        new_name: {
          type: 'string',
          description: 'The new name to give the project.'
        }
      },
      required: ['new_name']
    }
  }
},
{
  type: 'function',
  function: {
    name: 'get_undecided_items',
    description: 'List what information is still missing or undecided for a task or project - e.g. no deadline set, no budget set, no contractor assigned yet. Use for questions like "what\'s still undecided on this task", "what haven\'t we decided yet", "what\'s missing here".',
    parameters: {
      type: 'object',
      properties: {
        task_reference: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Which task, if asking about a task. Use "it"/"this task" for the most recently discussed one. Leave null if asking about a project instead.' },
        project_name: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Which project, if asking about a project rather than a task. Leave null to use the most recently discussed project.' }
      },
      required: []
    }
  }
}
];

module.exports = tools;