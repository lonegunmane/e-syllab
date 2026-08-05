import React from 'react';
import { User } from '../types';
import { SettingsView } from './SettingsView';

interface ProfileSectionProps {
  user: User;
  onUpdateUser: (user: User) => void;
}

export const ProfileSection: React.FC<ProfileSectionProps> = (props) => {
  return <SettingsView {...props} />;
};
