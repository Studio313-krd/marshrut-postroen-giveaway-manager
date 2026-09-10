export const participantName = (name, isInstagram = true) => isInstagram ? '@' + name.replace(/^@+/, '') : name;
