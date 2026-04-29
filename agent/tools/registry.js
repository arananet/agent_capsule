export class ToolRegistry {
  constructor() {
    /** @type {Map<string, {name: string, description: string, schema: object, handler: Function}>} */
    this.tools = new Map()
  }

  /**
   * @param {string}   name
   * @param {string}   description
   * @param {object}   schema       JSON Schema for the tool parameters
   * @param {Function} handler      async (args) => result
   */
  register(name, description, schema, handler) {
    this.tools.set(name, { name, description, schema, handler })
  }

  /**
   * @param {string} name
   * @param {object} args
   * @returns {Promise<any>}
   */
  async execute(name, args) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    return tool.handler(args)
  }

  /** @returns {Array<{name: string, description: string, parameters: object}>} */
  toToolDefinitions() {
    return [...this.tools.values()].map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.schema
    }))
  }
}
