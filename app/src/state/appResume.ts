export function isAppResume(previousState: string, nextState: string): boolean {
  return previousState !== 'active' && nextState === 'active';
}
