const isTTY = process.stdout.isTTY;

const color = isTTY
  ? {
      reset: '\x1b[0m',
      cyan: '\x1b[36m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
    }
  : null;

export function step(colorName, text) {
  console.log(color ? `${color[colorName]}${text}${color.reset}` : text);
}
