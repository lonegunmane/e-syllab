import React, { useState } from 'react';
import { User, UserRole } from '../types';
import { db } from '../services/database';
import { ShieldCheck, BookOpen, GraduationCap, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface StudentSetupModalProps {
  user: User;
  onComplete: (updatedUser: User) => void;
}

export const StudentSetupModal: React.FC<StudentSetupModalProps> = ({ user, onComplete }) => {
  const [step, setStep] = useState(1);
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);

  const grades = ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];
  const classes = ['A', 'B', 'C', 'D', 'E'];
  const subjectsList = [
    'Mathematics', 
    'Science Physics', 
    'Biology', 
    'Chemistry', 
    'Physical Education', 
    'Art', 
    'Food and Nutrition', 
    'Additional Mathematics', 
    'Computer Studies'
  ];

  const toggleSubject = (subject: string) => {
    setSelectedSubjects(prev => 
      prev.includes(subject) ? prev.filter(s => s !== subject) : [...prev, subject]
    );
  };

  const handleFinish = () => {
    const updatedUser: User = {
      ...user,
      grade: selectedGrade,
      className: selectedClass,
      enrolledSubjects: selectedSubjects,
      isProfileComplete: true
    };
    
    db.updateUserProfile(user.id, updatedUser);
    onComplete(updatedUser);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-card w-full max-w-2xl bg-slate-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
      >
        <div className="p-8 border-b border-white/5 bg-gradient-to-r from-emerald-600/10 to-transparent">
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 rounded-2xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white leading-none">Welcome, {user.name}</h2>
              <p className="text-slate-400 mt-1">Let's set up your profile to customize your dashboard.</p>
            </div>
          </div>
          
          <div className="flex gap-2 mt-6">
            {[1, 2, 3].map((s) => (
              <div 
                key={s} 
                className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                  s <= step ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="p-8 max-h-[60vh] overflow-y-auto">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div 
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-2 text-emerald-400">
                  <GraduationCap className="w-5 h-5" />
                  <span className="text-sm font-bold uppercase tracking-widest">Step 1: Your Grade</span>
                </div>
                <h3 className="text-xl font-semibold text-white">Which grade are you in?</h3>
                <div className="grid grid-cols-2 gap-4">
                  {grades.map(grade => (
                    <button
                      key={grade}
                      onClick={() => setSelectedGrade(grade)}
                      className={`p-6 rounded-2xl border text-left transition-all duration-300 group ${
                        selectedGrade === grade
                          ? 'bg-emerald-600/20 border-emerald-500/50 text-white shadow-[0_0_20px_rgba(16,185,129,0.1)]'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:bg-white/10'
                      }`}
                    >
                      <span className="text-lg font-bold">{grade}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div 
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-2 text-emerald-400">
                  <Users className="w-5 h-5" />
                  <span className="text-sm font-bold uppercase tracking-widest">Step 2: Your Class</span>
                </div>
                <h3 className="text-xl font-semibold text-white">Select your class</h3>
                <div className="grid grid-cols-5 gap-3">
                  {classes.map(cls => (
                    <button
                      key={cls}
                      onClick={() => setSelectedClass(cls)}
                      className={`p-4 rounded-xl border text-center transition-all duration-300 ${
                        selectedClass === cls
                          ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:border-emerald-500/30'
                      }`}
                    >
                      <span className="text-lg font-bold">{cls}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div 
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-2 text-emerald-400">
                  <BookOpen className="w-5 h-5" />
                  <span className="text-sm font-bold uppercase tracking-widest">Step 3: Your Subjects</span>
                </div>
                <h3 className="text-xl font-semibold text-white">Which subjects are you taking?</h3>
                <div className="grid grid-cols-2 gap-3">
                  {subjectsList.map(subject => (
                    <button
                      key={subject}
                      onClick={() => toggleSubject(subject)}
                      className={`p-4 rounded-xl border text-left transition-all duration-300 text-sm ${
                        selectedSubjects.includes(subject)
                          ? 'bg-emerald-600/20 border-emerald-500/50 text-white'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                      }`}
                    >
                      <span className="font-semibold">{subject}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="p-8 border-t border-white/5 flex items-center justify-between bg-slate-900/50">
          <button 
            disabled={step === 1}
            onClick={() => setStep(prev => prev - 1)}
            className={`px-6 py-2.5 rounded-xl font-bold transition-all ${
              step === 1 ? 'opacity-0 pointer-events-none' : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Previous
          </button>
          
          <button 
            onClick={() => {
              if (step < 3) {
                setStep(prev => prev + 1);
              } else {
                handleFinish();
              }
            }}
            disabled={(step === 1 && !selectedGrade) || (step === 2 && !selectedClass) || (step === 3 && selectedSubjects.length === 0)}
            className="px-8 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-900/40"
          >
            {step === 3 ? 'Finish Setup' : 'Continue'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
