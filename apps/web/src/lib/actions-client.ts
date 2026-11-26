/**
 * The server actions client code calls, each wrapped in `guardAction`: after a deploy an open page
 * shows the update banner instead of crashing. Client components import actions from here, never
 * from `@/app/actions` directly.
 */
import * as actions from "@/app/actions";
import { guardAction } from "@/lib/app-update";

export type { AssessJobState, DiscoveryActionState } from "@/app/actions";

export const assessJobAction = guardAction(actions.assessJobAction);
export const decideApprovalAction = guardAction(actions.decideApprovalAction);
export const deleteChat = guardAction(actions.deleteChat);
export const editPreferencesAction = guardAction(actions.editPreferencesAction);
export const editProfileAction = guardAction(actions.editProfileAction);
export const keepJobAction = guardAction(actions.keepJobAction);
export const keepPostingAction = guardAction(actions.keepPostingAction);
export const markJobSeenAction = guardAction(actions.markJobSeenAction);
export const renameChat = guardAction(actions.renameChat);
export const reorderBoardColumnAction = guardAction(actions.reorderBoardColumnAction);
export const retriageNowAction = guardAction(actions.retriageNowAction);
export const saveSearchSettingsAction = guardAction(actions.saveSearchSettingsAction);
export const setChatArchived = guardAction(actions.setChatArchived);
export const setInterviewRoundsAction = guardAction(actions.setInterviewRoundsAction);
export const setJobArchivedAction = guardAction(actions.setJobArchivedAction);
export const setJobLabelsAction = guardAction(actions.setJobLabelsAction);
export const setJobNotesAction = guardAction(actions.setJobNotesAction);
export const setJobStatusAction = guardAction(actions.setJobStatusAction);
export const setJobTitleAction = guardAction(actions.setJobTitleAction);
export const setJobTopAction = guardAction(actions.setJobTopAction);
export const setJobsStatusAction = guardAction(actions.setJobsStatusAction);
export const startDiscoveryAction = guardAction(actions.startDiscoveryAction);
export const startListingCheckAction = guardAction(actions.startListingCheckAction);
export const startRescoreAction = guardAction(actions.startRescoreAction);
export const startResearchAction = guardAction(actions.startResearchAction);
export const stopDiscoveryAction = guardAction(actions.stopDiscoveryAction);
