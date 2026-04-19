export interface UserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface NoteMetadata {
  id: string;
  title: string;
  modified_time: string;
}
