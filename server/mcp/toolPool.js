// Start each local tool server on first use and share its connection until shutdown.
export function createToolPool(connect) {
  const connections = new Map();

  async function getClient(name) {
    let pending = connections.get(name);
    if (!pending) {
      pending = connect(name);
      connections.set(name, pending);
      try {
        const client = await pending;
        client.onclose = () => {
          if (connections.get(name) === pending) connections.delete(name);
        };
      } catch (error) {
        if (connections.get(name) === pending) connections.delete(name);
        throw error;
      }
    }
    return pending;
  }

  async function call(name, tool, args) {
    const client = await getClient(name);
    const result = await client.callTool({ name: tool, arguments: args });
    const text = result.content?.find((part) => part.type === 'text')?.text;
    if (result.isError) throw new Error(text || `${tool} failed.`);
    return JSON.parse(text || 'null');
  }

  async function close() {
    const pending = [...connections.values()];
    connections.clear();
    await Promise.allSettled(pending.map(async (connection) => (await connection).close()));
  }

  return { call, close };
}
