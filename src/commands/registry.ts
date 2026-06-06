export interface Command {
  name: string;
  aliases: string[];
  handler: (args: string[]) => void | Promise<void>;
  helpKey: string;
}

const commands: Record<string, Command> = {};

export function register(name: string, aliases: string[], handler: (args: string[]) => void | Promise<void>, helpKey: string) {
  const cmd: Command = { name, aliases, handler, helpKey };
  for (const key of [name, ...aliases]) {
    commands[key.toLowerCase()] = cmd;
  }
}

export function getCommand(cmdName: string): Command | undefined {
  return commands[cmdName.toLowerCase()];
}
