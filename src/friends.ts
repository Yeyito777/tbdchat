/**
 * localStorage-backed friend store.
 */

const STORAGE_KEY = "tbdchat_friends";

export type Friend = {
  id: string;       // shortId of friend
  name: string;
  publicKey: string; // JSON-stringified JWK
  addedAt: number;
};

function load(): Friend[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as Friend[];
}

function save(friends: Friend[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(friends));
}

export function getFriends(): Friend[] {
  return load();
}

export function getFriend(id: string): Friend | undefined {
  return load().find((f) => f.id === id);
}

export function addFriend(friend: Friend): void {
  const friends = load();
  const existing = friends.findIndex((f) => f.id === friend.id);
  if (existing >= 0) {
    friends[existing] = friend;
  } else {
    friends.push(friend);
  }
  save(friends);
}

export function removeFriend(id: string): void {
  save(load().filter((f) => f.id !== id));
}
