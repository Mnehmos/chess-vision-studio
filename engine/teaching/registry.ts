import type {
  TeachingAction,
  TeachingFamily,
  TeachingMechanism,
  TeachingTopicId,
} from './types';

// Per-topic metadata. The compiler reads display names and families from here so
// vocabulary lives in one place.
export interface TopicMeta {
  id: TeachingTopicId;
  family: TeachingFamily;
  displayName: string;
  mechanisms: TeachingMechanism[];
}

export const TOPIC_REGISTRY: Record<TeachingTopicId, TopicMeta> = {
  allowed_fork: {
    id: 'allowed_fork',
    family: 'tactics',
    displayName: 'Allowed Fork',
    mechanisms: ['fork'],
  },
  allowed_pin: {
    id: 'allowed_pin',
    family: 'tactics',
    displayName: 'Allowed Pin',
    mechanisms: ['pin'],
  },
  missed_hanging_piece: {
    id: 'missed_hanging_piece',
    family: 'piece_safety',
    displayName: 'Missed Hanging Piece',
    mechanisms: ['hanging_piece'],
  },
  failed_defense: {
    id: 'failed_defense',
    family: 'defense',
    displayName: 'Failed Defense',
    mechanisms: ['only_defender', 'king_attack', 'hanging_piece'],
  },
  pawn_structure_damage: {
    id: 'pawn_structure_damage',
    family: 'pawn_structure',
    displayName: 'Pawn Structure Damage',
    mechanisms: ['doubled_pawn', 'isolated_pawn'],
  },
};

// The whitelist (plan §4): only these (action, mechanism) pairs name a topic.
// We do NOT auto-generate every action×mechanism combination — an unlisted pair
// resolves to null and never becomes a committed event.
const WHITELIST: { action: TeachingAction; mechanism: TeachingMechanism; topicId: TeachingTopicId }[] = [
  { action: 'allowed', mechanism: 'fork', topicId: 'allowed_fork' },
  { action: 'allowed', mechanism: 'pin', topicId: 'allowed_pin' },
  { action: 'missed', mechanism: 'hanging_piece', topicId: 'missed_hanging_piece' },
  { action: 'failed_to_answer', mechanism: 'only_defender', topicId: 'failed_defense' },
  { action: 'failed_to_answer', mechanism: 'king_attack', topicId: 'failed_defense' },
  { action: 'failed_to_answer', mechanism: 'hanging_piece', topicId: 'failed_defense' },
  { action: 'worsened', mechanism: 'doubled_pawn', topicId: 'pawn_structure_damage' },
  { action: 'worsened', mechanism: 'isolated_pawn', topicId: 'pawn_structure_damage' },
  { action: 'created', mechanism: 'doubled_pawn', topicId: 'pawn_structure_damage' },
  { action: 'created', mechanism: 'isolated_pawn', topicId: 'pawn_structure_damage' },
  { action: 'accepted_tradeoff', mechanism: 'doubled_pawn', topicId: 'pawn_structure_damage' },
  { action: 'accepted_tradeoff', mechanism: 'isolated_pawn', topicId: 'pawn_structure_damage' },
];

export function resolveTopicId(
  action: TeachingAction,
  mechanism: TeachingMechanism,
): TeachingTopicId | null {
  return WHITELIST.find((w) => w.action === action && w.mechanism === mechanism)?.topicId ?? null;
}

export function topicMeta(id: TeachingTopicId): TopicMeta {
  return TOPIC_REGISTRY[id];
}
