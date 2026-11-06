// The tutorial in a file of its own (v2.34.2, the faster first load): its flow from the title, the
// lessons and the lesson under way (play/lesson.ts). Fetched once the title is up; the rest of the
// game reaches it through play/lazy.ts.
export * from '../play/lesson';
export { tutorialFlow } from '../flows/tutorial';
