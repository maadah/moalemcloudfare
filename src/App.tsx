// Smart Grader - AI Powered Exam System (Netlify Optimized)
import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Trash2, Save, FileText, Upload, CheckCircle, 
  XCircle, ChevronDown, ChevronUp, Download, LogIn, 
  LogOut, Loader2, FileUp, List, Settings, User,
  HelpCircle, CheckSquare, Type, LayoutGrid, Image as ImageIcon,
  ArrowRight, Calendar, Folder, FolderOpen, Users, Camera, Layers,
  Phone, MessageCircle, Printer, BookOpen, PlusCircle, Bell, Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, addDoc, query, where, onSnapshot, 
  serverTimestamp, doc, updateDoc, deleteDoc, getDoc, setDoc,
  getDocFromServer, increment, getDocs, writeBatch, orderBy
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { Question, gradeStudentPaper, extractExamFromImages, extractExamFromDualImages } from './services/geminiService';
import jsPDF from 'jspdf';

const ARABIC_BRANCH_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function ContactButtons({ className }: { className?: string }) {
  return (
    <div className={cn("bg-white/50 backdrop-blur-sm p-4 rounded-2xl border border-white/50 space-y-3 mt-8 max-w-sm w-full", className)}>
      <p className="text-stone-500 text-sm font-bold text-center mb-2">للتواصل مع الإدارة والتفعيل:</p>
      <div className="grid grid-cols-1 gap-2">
        <a 
          href="tel:07706118992" 
          className="flex items-center justify-center gap-2 text-stone-700 bg-white border border-stone-200 py-2.5 rounded-xl font-bold hover:bg-stone-50 transition-all shadow-sm group"
        >
          <Phone className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform" />
          <span dir="ltr">07706118992</span>
        </a>
        <a 
          href="https://wa.me/9647706118992" 
          target="_blank" 
          rel="noreferrer"
          translate="no"
          className="bg-[#25D366] text-white py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-sm group"
        >
          <MessageCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />
          تواصل عبر واتساب
        </a>
      </div>
    </div>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "حدث خطأ غير متوقع في التطبيق.";
      let technicalDetails = "";
      
      try {
        if (this.state.error?.message) {
          try {
            const parsed = JSON.parse(this.state.error.message);
            if (parsed.error) {
              errorMessage = `خطأ في قاعدة البيانات: ${parsed.error}`;
            } else {
              errorMessage = this.state.error.message;
            }
          } catch (e) {
            // Not a JSON error, just use the raw message
            errorMessage = this.state.error.message;
          }
        }
        
        // Add technical details for debugging
        technicalDetails = this.state.error?.stack || String(this.state.error);
      } catch (e) {}

      return (
        <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4 text-center" dir="rtl">
          <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-stone-200">
            <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-stone-900 mb-2">عذراً، حدث خطأ</h2>
            <p className="text-stone-600 mb-4">{errorMessage}</p>
            
            {technicalDetails && (
              <details className="mb-6 text-right">
                <summary className="text-[10px] text-stone-400 cursor-pointer hover:text-stone-600">التفاصيل التقنية (للمطور)</summary>
                <pre className="mt-2 p-3 bg-stone-50 rounded-xl text-[8px] text-stone-500 text-left overflow-auto max-h-32 dir-ltr">
                  {technicalDetails}
                </pre>
              </details>
            )}

            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-stone-900 text-white py-3 rounded-xl font-medium hover:bg-stone-800 transition-colors"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

type View = 'dashboard' | 'create-exam' | 'grade-papers' | 'results' | 'admin';

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  status: 'pending' | 'approved' | 'rejected';
  role: 'admin' | 'user';
  pageLimit: number;
  questionsCount: number;
  gradingsCount: number;
  pagesUsed: number;
  createdAt: any;
  isNew?: boolean;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- PDF Generation Utility ---
const generatePDFFromElement = async (element: HTMLElement, fileName: string, options: { padding?: string, useElementWidth?: boolean, ignoreImages?: boolean } = {}) => {
  try {
    console.log(`[PDF] Starting generation for: ${fileName}, ignoreImages: ${!!options.ignoreImages}`);
    
    // Check if element is valid
    if (!element) {
      throw new Error('العنصر المطلوب تصويره غير موجود');
    }

    // Ensure element has some visibility/dimensions for html2canvas
    const originalStyle = element.style.cssText;
    if (element.offsetHeight === 0) {
      console.warn('[PDF] Element has 0 height, attempting to force dimensions');
      element.style.display = 'block';
      element.style.visibility = 'visible';
      element.style.position = 'relative';
    }

    // Ensure all images are loaded before capturing (only if not ignoring them)
    if (!options.ignoreImages) {
      const images = element.getElementsByTagName('img');
      await Promise.all(Array.from(images).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      }));
    }

    // Small delay to ensure styles and images are fully rendered
    await new Promise(resolve => setTimeout(resolve, options.ignoreImages ? 600 : 1200));

    const canvas = await html2canvas(element, {
      scale: 2, 
      useCORS: !options.ignoreImages,
      allowTaint: false, 
      logging: true, // Enable logging for debugging
      backgroundColor: '#ffffff',
      windowWidth: options.useElementWidth ? (element.scrollWidth || 1200) : 1200,
      onclone: (clonedDoc, clonedElement) => {
        if (clonedElement instanceof HTMLElement) {
          clonedElement.style.position = 'static';
          clonedElement.style.visibility = 'visible';
          clonedElement.style.display = 'block';
          clonedElement.style.opacity = '1';
          clonedElement.style.width = '210mm';
          clonedElement.style.margin = '0';
          clonedElement.style.boxSizing = 'border-box';
          
          if (options.padding) {
            clonedElement.style.padding = options.padding;
          }

          // Aggressively remove oklch from all elements in the clone
          // html2canvas fails when it encounters oklch() in computed styles
          const allElements = clonedElement.querySelectorAll('*');
          allElements.forEach(el => {
            if (el instanceof HTMLElement) {
              // Remove any inline styles that might use oklch
              const style = el.getAttribute('style');
              if (style && style.includes('oklch')) {
                el.setAttribute('style', style.replace(/oklch\([^)]+\)/g, '#888'));
              }
            }
          });

          // Remove problematic CSS rules from the cloned document to prevent html2canvas from crashing
          try {
            const styleSheets = Array.from(clonedDoc.styleSheets);
            styleSheets.forEach(sheet => {
              try {
                const rules = Array.from(sheet.cssRules);
                for (let i = rules.length - 1; i >= 0; i--) {
                  if (rules[i].cssText.includes('oklch')) {
                    sheet.deleteRule(i);
                  }
                }
              } catch (e) { /* Ignore cross-origin sheet errors */ }
            });
          } catch (e) { /* Ignore global errors */ }

          // Inject a style tag to override Tailwind 4's oklch variables with safe hex values
          const styleTag = clonedDoc.createElement('style');
          styleTag.innerHTML = `
            :root, * {
              --color-stone-50: #fafaf9 !important;
              --color-stone-100: #f5f5f4 !important;
              --color-stone-200: #e7e5e4 !important;
              --color-stone-300: #d6d3d1 !important;
              --color-stone-400: #a8a29e !important;
              --color-stone-500: #78716c !important;
              --color-stone-600: #57534e !important;
              --color-stone-700: #44403c !important;
              --color-stone-800: #292524 !important;
              --color-stone-900: #1c1917 !important;
              --color-emerald-50: #ecfdf5 !important;
              --color-emerald-100: #d1fae5 !important;
              --color-emerald-600: #059669 !important;
              --color-emerald-700: #047857 !important;
              --color-emerald-800: #065f46 !important;
              --color-red-500: #ef4444 !important;
              --color-red-600: #dc2626 !important;
            }
            /* Force hex for common classes */
            .bg-emerald-600 { background-color: #059669 !important; }
            .text-emerald-600 { color: #059669 !important; }
            .bg-stone-900 { background-color: #1c1917 !important; }
            .text-stone-900 { color: #1c1917 !important; }
          `;
          clonedDoc.head.appendChild(styleTag);
          
          const clonedImages = clonedElement.getElementsByTagName('img');
          for (let i = 0; i < clonedImages.length; i++) {
            if (options.ignoreImages) {
              clonedImages[i].style.display = 'none';
            } else {
              if (!clonedImages[i].src.startsWith('data:')) {
                clonedImages[i].crossOrigin = 'anonymous';
              }
              clonedImages[i].style.display = 'block';
              clonedImages[i].style.maxWidth = '100%';
            }
          }
        }
      }
    });
    
    // Restore original style if modified
    if (originalStyle) {
      element.style.cssText = originalStyle;
    }

    if (canvas.width === 0 || canvas.height === 0) {
      throw new Error(`أبعاد الصفحة غير صالحة (W: ${canvas.width}, H: ${canvas.height})`);
    }

    const imgData = canvas.toDataURL('image/jpeg', 0.9); 
    if (imgData === 'data:,') throw new Error('فشل استخراج بيانات الصورة من الصفحة');

    const pdf = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4'
    });
    
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const imgProps = pdf.getImageProperties(imgData);
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
    
    const pageHeight = pdf.internal.pageSize.getHeight();
    let heightLeft = pdfHeight;
    let position = 0;

    pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - pdfHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(fileName);
    console.log(`[PDF] Successfully saved: ${fileName}`);
  } catch (error) {
    console.error('Error generating PDF:', error);
    const errorMsg = error instanceof Error ? error.message : 'خطأ غير معروف';
    alert(`عذراً، حدث خطأ تقني أثناء إنشاء ملف PDF: ${errorMsg}. يرجى محاولة فتح تفاصيل الطالب أولاً ثم التحميل.`);
  }
};

// --- Helper to clean redundant labels from text ---
const calculateGradingTotal = (gradings: any[]): number => {
  if (!gradings) return 0;
  return gradings.reduce((acc, g) => acc + (Number(g.grade) || 0), 0);
};

const formatGrade = (grade: number | string | undefined | null) => {
  if (grade === undefined || grade === null || grade === "") return "?";
  const num = Number(grade);
  if (isNaN(num)) return grade.toString();
  // If it's a whole number, return it as is. If it has decimals, limit to 1 decimal place.
  return num % 1 === 0 ? num.toString() : num.toFixed(1).replace(/\.0$/, '');
};

const calculateRecursiveTotalGrade = (qs: any[]): number => {
  if (!qs) return 0;
  return qs.reduce((acc, q) => {
    if (q.subQuestions && q.subQuestions.length > 0) {
      return acc + calculateRecursiveTotalGrade(q.subQuestions);
    }
    return acc + (Number(q.grade) || 0);
  }, 0);
};

function cleanQuestionText(text: string, label?: string) {
  if (!text) return "";
  let cleaned = text.trim();
  
  if (label) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escapedLabel}[:.\\s-]*`, 'i');
    cleaned = cleaned.replace(regex, '').trim();
  }
  
  // Also common patterns if label wasn't passed or match failed
  const commonPrefixes = [/^[سQ]\s*\d+[:. -]*/i, /^[أبجدهوزحطيكل]\s*[:. -]+/i, /^فرع\s+[أبجدهوز]\s*[:. -]*/i];
  commonPrefixes.forEach(p => {
    cleaned = cleaned.replace(p, '').trim();
  });

  return cleaned;
}

function GradingResultItem({ question, gradings, onGradeChange, level = 1 }: any) {
  const grading = gradings?.find((g: any) => g.questionId === question.id);
  const hasSub = question.subQuestions && question.subQuestions.length > 0;
  
  // Try to extract a clean label (e.g., "س1" or "أ")
  let label = question.text.split(/[:./\(\)\[\]-]/)[0].trim();
  if (label.length > 15 || label.length === 0) label = "";
  
  const displayLabel = level === 1 
    ? `سؤال ${label.replace(/^[سQ]/i, '').trim() || ''}`
    : label;

  return (
    <div className={cn(
      "p-4 md:p-6 rounded-2xl border space-y-3 transition-all",
      level === 1 ? "bg-stone-50 border-stone-100 shadow-sm" : "bg-white border-stone-50 mr-2 md:mr-6"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2 flex-1">
          <div className="flex items-start gap-2">
            <span className="font-bold text-stone-700 whitespace-nowrap">
              {displayLabel}:
            </span>
            <span className="text-stone-800">{cleanQuestionText(question.text, label)}</span>
          </div>
          {question.questionImage && (
            <img 
              src={question.questionImage} 
              alt="سؤال" 
              className="w-48 h-auto max-h-64 object-contain rounded-xl border border-stone-200 mt-2" 
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
            />
          )}
        </div>
        {!hasSub && grading && (
          <div className="flex items-center gap-2 mr-4">
            {onGradeChange ? (
              <input 
                type="number" 
                value={grading.grade} 
                onChange={(e) => onGradeChange(question.id, Number(e.target.value))}
                className="w-16 px-2 py-1 rounded-lg border border-stone-200 text-center font-bold text-emerald-600 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            ) : (
              <div className="px-4 py-2 bg-white rounded-xl border border-stone-200 font-bold text-emerald-600 shadow-sm">
                {formatGrade(grading.grade)}
              </div>
            )}
            <span className="text-stone-400 font-medium">/ {formatGrade(question.grade || grading?.maxGrade)}</span>
          </div>
        )}
      </div>

      {!hasSub && grading && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div className="space-y-2">
              <span className="text-stone-400 font-bold flex items-center gap-1 uppercase tracking-wider text-[10px]">
                <User className="w-3 h-3" /> إجابة الطالب:
              </span>
              <p 
                className="p-4 bg-white rounded-2xl border border-stone-100 italic text-stone-700 leading-relaxed shadow-sm"
                style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}
              >
                "{grading.studentAnswer}"
              </p>
            </div>
            <div className="space-y-2">
              <span className="text-stone-400 font-bold flex items-center gap-1 uppercase tracking-wider text-[10px]">
                <CheckCircle className="w-3 h-3" /> الإجابة النموذجية:
              </span>
              <div className="flex flex-col gap-3">
                <p 
                  className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-emerald-900 leading-relaxed shadow-sm"
                  style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}
                >
                  "{question.answer || 'غير متوفرة'}"
                </p>
                {question.answerImage && (
                  <img 
                    src={question.answerImage} 
                    alt="إجابة نموذجية" 
                    className="w-48 h-auto max-h-64 object-contain rounded-xl border border-emerald-100" 
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                  />
                )}
              </div>
            </div>
          </div>
          {grading.feedback && (
            <div className="pt-4 border-t border-stone-100">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider flex items-center gap-1">
                <FileText className="w-3 h-3" /> ملاحظات المصحح:
              </span>
              <p className="text-stone-600 mt-2 leading-relaxed bg-stone-100/50 p-3 rounded-xl">{grading.feedback}</p>
            </div>
          )}
        </div>
      )}

      {hasSub && (
        <div className="space-y-4 mt-6 border-r-2 border-stone-100 pr-2">
          {question.subQuestions.map((sq: any) => (
            <GradingResultItem 
              key={sq.id} 
              question={sq} 
              gradings={gradings} 
              onGradeChange={onGradeChange} 
              level={level + 1} 
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExam, setSelectedExam] = useState<any>(null);
  const [editingExam, setEditingExam] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setPendingCount(0);
      return;
    }
    
    const isAdminEmail = user.email?.toLowerCase()?.trim() === 'asmaomar5566@gmail.com';
    const isAdminRole = userProfile?.role === 'admin';
    
    if (!isAdminEmail && !isAdminRole) {
      setPendingCount(0);
      return;
    }

    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allUsers = snapshot.docs.map(doc => doc.data());
      const newCount = allUsers.filter((u: any) => u.isNew).length;
      console.log("Nav: Calculated new registrations count:", newCount);
      setPendingCount(newCount);
    }, (error) => console.error("Users listener error:", error));
    return () => unsubscribe();
  }, [user?.email, userProfile?.role]);

  useEffect(() => {
    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Firestore is offline. Check configuration.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      try {
        setUser(u);
        if (u) {
          // Fetch or create user profile
          const userDocRef = doc(db, 'users', u.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (userDoc.exists()) {
            let data = userDoc.data() as UserProfile;
            const isAdminEmail = u.email?.toLowerCase()?.trim() === 'asmaomar5566@gmail.com';
            
            if (isAdminEmail && data.role !== 'admin') {
              console.log("Auth: Updating admin role...");
              await updateDoc(userDocRef, { role: 'admin', status: 'approved' });
              data.role = 'admin';
              data.status = 'approved';
            }
            console.log("Auth: User profile loaded:", data);
            setUserProfile(data);
          } else {
            console.log("Auth: No user profile found. Creating new profile...");
            const isAdminEmail = u.email?.toLowerCase()?.trim() === 'asmaomar5566@gmail.com';
            const newProfile: UserProfile = {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || '',
              status: 'approved', // Always approved now
              role: isAdminEmail ? 'admin' : 'user',
              isNew: !isAdminEmail, // Mark as new for admin notification
              pageLimit: 100,
              pagesUsed: 0,
              questionsCount: 0,
              gradingsCount: 0,
              createdAt: serverTimestamp()
            };
            await setDoc(userDocRef, newProfile);
            console.log("Auth: New profile created:", newProfile);
            setUserProfile(newProfile);
          }
        } else {
          setUserProfile(null);
        }
      } catch (error) {
        console.error("Auth state error:", error);
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        setUserProfile(snapshot.data() as UserProfile);
      }
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || userProfile?.status !== 'approved') return;
    const q = query(collection(db, 'exams'), where('authorUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setExams(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error("Exams snapshot error:", error));
    return () => unsubscribe();
  }, [user, userProfile?.status]);

  useEffect(() => {
    if (!user || userProfile?.status !== 'approved') return;
    const q = query(collection(db, 'results'), where('authorUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setResults(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error("Results snapshot error:", error));
    return () => unsubscribe();
  }, [user, userProfile?.status]);

  useEffect(() => {
    if (!user || userProfile?.status !== 'approved') return;
    const q = query(collection(db, 'sessions'), where('authorUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSessions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error("Sessions snapshot error:", error));
    return () => unsubscribe();
  }, [user, userProfile?.status]);

  const login = async () => {
    try {
      const provider = new GoogleAuthProvider();
      // Ensure we use popup for better compatibility with iframes
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login error:", error);
      
      const errorMessage = error.message || "";
      const isMissingInitialState = errorMessage.includes("missing initial state") || 
                                   errorMessage.includes("sessionStorage is inaccessible");
      
      if (error.code === 'auth/unauthorized-domain') {
        alert("خطأ: هذا النطاق غير مصرح به في إعدادات Firebase. يرجى التأكد من إضافة رابط المعاينة الحالي في Firebase Console > Authentication > Settings > Authorized domains.");
      } else if (error.code === 'auth/network-request-failed') {
        alert("خطأ في الاتصال: تعذر الوصول إلى خوادم التحقق. يرجى التأكد من جودة اتصال الإنترنت، أو حاول إيقاف أي مانع إعلانات (AdBlocker) قد يمنع خدمات Google، ثم حاول مرة أخرى.");
      } else if (isMissingInitialState) {
        alert("تنبيه: تعذر إكمال تسجيل الدخول بسبب قيود في المتصفح أو بيئة العرض (Iframe).\n\nالحل: يرجى الضغط على زر 'Open in new tab' أو 'فتح في نافذة جديدة' في أعلى الصفحة لتشغيل التطبيق بشكل مستقل، ثم حاول تسجيل الدخول مرة أخرى.");
      } else {
        alert("حدث خطأ أثناء تسجيل الدخول: " + errorMessage);
      }
    }
  };

  const logout = () => signOut(auth);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-stone-200 text-center"
        >
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <FileText className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-bold text-stone-900 mb-2 font-serif italic">المصحح الذكي</h1>
          <p className="text-stone-500 mb-8">نظام ذكي لتصحيح أوراق الطلاب المكتوبة بخط اليد</p>
          <button 
            onClick={login}
            className="w-full bg-stone-900 text-white py-4 rounded-2xl font-medium flex items-center justify-center gap-2 hover:bg-stone-800 transition-colors"
          >
            <LogIn className="w-5 h-5" />
            تسجيل الدخول باستخدام جوجل
          </button>
          
          <ContactButtons />
        </motion.div>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-emerald-600 mx-auto" />
          <p className="text-stone-500">جاري تحميل ملف المستخدم...</p>
          <button onClick={logout} className="text-stone-400 hover:text-red-500 transition-colors text-sm underline">
            تسجيل الخروج
          </button>
        </div>
      </div>
    );
  }

  if (userProfile.status === 'pending') {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4" dir="rtl">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-lg w-full bg-white p-10 rounded-3xl shadow-xl border border-stone-200 text-center space-y-6"
        >
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
            <Loader2 className="w-10 h-10 text-amber-600 animate-spin" />
          </div>
          <h2 className="text-2xl font-bold text-stone-900">طلبك قيد المراجعة</h2>
          <p className="text-stone-600 leading-relaxed">
            مرحباً بك في المصحح الذكي. حسابك حالياً قيد الانتظار لحين موافقة مسؤول المشروع.
            <br />
            يرجى التواصل مع الإدارة لتفعيل حسابك وتحديد باقة الصفحات الخاصة بك.
          </p>
          
          <div className="bg-stone-50 p-6 rounded-2xl space-y-4 border border-stone-100">
            <p className="font-bold text-stone-700">للتواصل والتفعيل:</p>
            <div className="flex flex-col gap-3">
              <a 
                href="tel:07706118992" 
                className="flex items-center justify-center gap-2 text-emerald-600 font-bold text-xl hover:underline"
              >
                07706118992
              </a>
              <a 
                href="https://wa.me/9647706118992" 
                target="_blank" 
                rel="noreferrer"
                translate="no"
                className="bg-emerald-500 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-emerald-600 transition-colors"
              >
                تواصل عبر واتساب
              </a>
            </div>
          </div>

          <button onClick={logout} className="text-stone-400 hover:text-red-500 transition-colors text-sm">
            تسجيل الخروج
          </button>
        </motion.div>
      </div>
    );
  }

  if (userProfile.status === 'rejected') {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4" dir="rtl">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-stone-200 text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-stone-900 mb-2">تم رفض الطلب</h2>
          <p className="text-stone-500 mb-6">عذراً، تم رفض طلب انضمامك للمشروع. يرجى التواصل مع الإدارة للمزيد من التفاصيل.</p>
          <div className="mb-6">
            <ContactButtons />
          </div>
          <button onClick={logout} className="w-full bg-stone-900 text-white py-3 rounded-xl font-medium">
            تسجيل الخروج
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans" dir="rtl">
      {/* Navigation */}
      <nav className="bg-white border-b border-stone-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 
              className="text-lg md:text-xl font-bold font-serif italic cursor-pointer whitespace-nowrap"
              onClick={() => setView('dashboard')}
            >
              المصحح الذكي
            </h1>
            <div className="hidden md:flex items-center gap-4">
              <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<LayoutGrid className="w-4 h-4" />} label="لوحة التحكم" />
              <NavButton active={view === 'create-exam'} onClick={() => setView('create-exam')} icon={<Plus className="w-4 h-4" />} label="إنشاء امتحان" />
              <NavButton active={view === 'results'} onClick={() => setView('results')} icon={<List className="w-4 h-4" />} label="النتائج" />
              {(userProfile?.role === 'admin' || user.email?.toLowerCase()?.trim() === 'asmaomar5566@gmail.com') && (
                <div className="relative">
                  <NavButton active={view === 'admin'} onClick={() => setView('admin')} icon={<Users className="w-4 h-4" />} label="الإدارة" />
                  {pendingCount > 0 && (
                    <span className="absolute -top-1 -left-1 w-5 h-5 bg-red-600 text-white text-[10px] font-black rounded-full flex items-center justify-center animate-bounce shadow-lg ring-2 ring-white">
                      {pendingCount}
                    </span>
                  )}
                </div>
              )}
              <div className="h-4 w-px bg-stone-200 mx-2 hidden xl:block" />
              <div className="hidden xl:flex items-center gap-4">
                <a href="tel:07706118992" className="flex items-center gap-1.5 text-[10px] font-black text-stone-400 uppercase tracking-tighter hover:text-emerald-600 transition-colors">
                  <Phone className="w-3 h-3" />
                  اتصال
                </a>
                <a href="https://wa.me/9647706118992" target="_blank" rel="noreferrer" translate="no" className="flex items-center gap-1.5 text-[10px] font-black text-stone-400 uppercase tracking-tighter hover:text-[#25D366] transition-colors">
                  <MessageCircle className="w-3 h-3" />
                  واتساب
                </a>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden lg:flex flex-col items-end mr-2">
              <span className="text-[10px] text-stone-400">استهلاك الصفحات</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full transition-all",
                      (userProfile?.pagesUsed || 0) / (userProfile?.pageLimit || 1) > 0.9 ? "bg-red-500" : "bg-emerald-500"
                    )}
                    style={{ width: `${Math.min(100, ((userProfile?.pagesUsed || 0) / (userProfile?.pageLimit || 1)) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold text-stone-600">{userProfile?.pagesUsed} / {userProfile?.pageLimit}</span>
              </div>
            </div>
              {/* Manual API key button removed — keys now come from Cloudflare environment variables */}
            <div className="flex items-center gap-2 px-1.5 md:px-3 py-1.5 bg-stone-100 rounded-full">
              <img src={user.photoURL || ''} alt="" className="w-6 h-6 rounded-full" />
              <span className="hidden sm:inline text-sm font-medium">{user.displayName}</span>
            </div>
            <button onClick={logout} className="p-2 text-stone-400 hover:text-red-500 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* Bottom Navigation for Mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-stone-200 z-50 px-2 py-1 pb-safe shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
        <div className="flex items-center justify-around max-w-md mx-auto">
          <NavButton mobile active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<LayoutGrid className="w-5 h-5" />} label="الرئيسية" />
          <NavButton mobile active={view === 'create-exam'} onClick={() => setView('create-exam')} icon={<Plus className="w-5 h-5" />} label="امتحان" />
          <NavButton mobile active={view === 'results'} onClick={() => setView('results')} icon={<List className="w-5 h-5" />} label="النتائج" />
          {(userProfile?.role === 'admin' || user.email?.toLowerCase().trim() === 'asmaomar5566@gmail.com') && (
            <div className="relative">
              <NavButton mobile active={view === 'admin'} onClick={() => setView('admin')} icon={<Users className="w-5 h-5" />} label="الإدارة" />
              {pendingCount > 0 && (
                <span className="absolute -top-1 -left-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-bounce border-2 border-white shadow-sm">
                  {pendingCount}
                </span>
              )}
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-2 sm:p-4 md:p-8 pb-24 md:pb-8">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && (
            <Dashboard 
              exams={exams} 
              userProfile={userProfile}
              onNewExam={() => { setEditingExam(null); setView('create-exam'); }} 
              onGrade={(exam) => { setSelectedExam(exam); setView('grade-papers'); }}
              onEditExam={(exam) => { setEditingExam(exam); setView('create-exam'); }}
              onDeleteExam={async (id) => { if(confirm('هل أنت متأكد من حذف هذا الامتحان؟')) await deleteDoc(doc(db, 'exams', id)); }}
            />
          )}
          {view === 'create-exam' && (
            <ExamCreator 
              user={user} 
              userProfile={userProfile}
              initialData={editingExam}
              onSave={() => { setEditingExam(null); setView('dashboard'); }} 
              onCancel={() => { setEditingExam(null); setView('dashboard'); }} 
            />
          )}
          {view === 'grade-papers' && (
            <Grader 
              user={user}
              userProfile={userProfile}
              exam={selectedExam} 
              sessions={sessions}
              onComplete={() => setView('results')}
              onCancel={() => setView('dashboard')}
            />
          )}
          {view === 'results' && (
            <ResultsView 
              results={results} 
              sessions={sessions}
              exams={exams}
              onBack={() => setView('dashboard')}
            />
          )}
          {view === 'admin' && (userProfile?.role === 'admin' || user.email === 'asmaomar5566@gmail.com') && (
            <AdminDashboard />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function AdminDashboard() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log("AdminDashboard: Starting users listener...");
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log("AdminDashboard: Received users snapshot, size:", snapshot.size);
      const fetchedUsers = snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id } as UserProfile));
      
      // Sort in JS: New users (isNew) first, then by createdAt desc, then by email
      fetchedUsers.sort((a: any, b: any) => {
        if (a.isNew && !b.isNew) return -1;
        if (!a.isNew && b.isNew) return 1;
        
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        if (timeA !== timeB) return timeB - timeA;
        
        return (a.email || "").localeCompare(b.email || "");
      });

      console.log("AdminDashboard: Sorted users:", fetchedUsers);
      setUsers(fetchedUsers);
      setLoading(false);
    }, (error) => {
      console.error("AdminDashboard: Admin view users listener error:", error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const updateUserStatus = async (uid: string, status: 'approved' | 'rejected') => {
    try {
      await updateDoc(doc(db, 'users', uid), { status });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const updateUserLimit = async (uid: string, limit: number) => {
    try {
      await updateDoc(doc(db, 'users', uid), { pageLimit: limit });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const deleteUser = async (uid: string) => {
    if (confirm('هل أنت متأكد من حذف هذا المستخدم نهائياً؟')) {
      try {
        await deleteDoc(doc(db, 'users', uid));
      } catch (e) {
        handleFirestoreError(e, OperationType.DELETE, `users/${uid}`);
      }
    }
  };

  const acknowledgeNewUser = async (uid: string) => {
    try {
      await updateDoc(doc(db, 'users', uid), { isNew: false });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const newUsers = users.filter(u => u.isNew);
  const allOtherUsers = users.filter(u => !u.isNew && (u.role !== 'admin' || u.email?.toLowerCase()?.trim() === 'asmaomar5566@gmail.com'));

  useEffect(() => {
    console.log("AdminDashboard Check: Total users:", users.length);
    console.log("AdminDashboard Check: New users:", newUsers.length);
    console.log("AdminDashboard Check: Active users:", allOtherUsers.length);
  }, [users, newUsers.length, allOtherUsers.length]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 md:space-y-8 pb-10"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl md:text-3xl font-bold font-serif italic">لوحة تحكم المدير</h2>
          <p className="text-xs text-stone-400">إدارة المستخدمين والصلاحيات ومتابعة التسجيلات الجديدة</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-emerald-100 text-emerald-700 px-4 py-2 rounded-xl text-sm font-bold shadow-sm">
            إجمالي المستخدمين: {users.length}
          </div>
          {newUsers.length > 0 && (
            <div className="bg-blue-100 text-blue-600 px-4 py-2 rounded-xl text-sm font-bold shadow-sm flex items-center gap-2 animate-pulse">
              <Bell className="w-4 h-4" />
              جديد: {newUsers.length}
            </div>
          )}
        </div>
      </div>

      {users.length === 0 && !loading && (
        <div className="p-12 text-center bg-white rounded-3xl border-2 border-dashed border-stone-200 text-stone-400">
          لم يتم العثور على أي مستخدمين في قاعدة البيانات. 
          <br/>
          تأكد من أنك مسجل دخول بالحساب الصحيح وأن الحسابات الأخرى قد أكملت عملية التسجيل.
        </div>
      )}

      {newUsers.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-blue-600 flex items-center gap-2">
            تسجيلات جديدة لم تطلع عليها بعد ({newUsers.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {newUsers.map(u => (
              <div key={u.uid} className="bg-white p-6 rounded-3xl border border-blue-200 shadow-md flex flex-col sm:flex-row items-center justify-between gap-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-1 h-full bg-blue-500"></div>
                <div className="flex items-center gap-4 w-full">
                  <div className="w-12 h-12 bg-blue-50 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-blue-600">
                    {u.displayName?.charAt(0) || u.email?.charAt(0) || '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold truncate">{u.displayName || 'بدون اسم'}</p>
                    <p className="text-xs text-stone-400 truncate mb-1">{u.email}</p>
                    <p className="text-[10px] text-blue-400 font-bold">انضم: {u.createdAt ? new Date(u.createdAt.seconds * 1000).toLocaleString('ar-EG') : 'الآن'}</p>
                  </div>
                </div>
                <button 
                  onClick={() => acknowledgeNewUser(u.uid)}
                  className="w-full sm:w-auto bg-blue-600 text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  <CheckCircle className="w-4 h-4" />
                  تمييز كمقروء
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-xl font-bold">قائمة الأعضاء ({users.length})</h3>
        
        {/* Desktop Table */}
        <div className="hidden lg:block bg-white rounded-3xl border border-stone-200 overflow-hidden shadow-sm">
          <table className="w-full text-right">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">المستخدم</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">تاريخ الانضمام</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">الاستهلاك</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">البيانات</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">الحد</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {users.map(u => (
                <tr key={u.uid} className={cn("hover:bg-stone-50 transition-colors", u.isNew && "bg-blue-50/20")}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold", u.isNew ? "bg-blue-100 text-blue-600" : "bg-stone-100 text-stone-400")}>
                        {u.displayName?.charAt(0) || u.email?.charAt(0) || '?'}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold truncate">{u.displayName || 'بدون اسم'}</p>
                          {u.isNew && <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded text-[8px] font-bold">جديد</span>}
                        </div>
                        <p className="text-[10px] text-stone-400 truncate">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[11px] text-stone-500">
                    {u.createdAt ? new Date(u.createdAt.seconds * 1000).toLocaleDateString('ar-EG') : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                        <div 
                          className={cn("h-full transition-all", (u.pagesUsed || 0) / (u.pageLimit || 1) > 0.9 ? "bg-red-500" : "bg-emerald-500")}
                          style={{ width: `${Math.min(100, ((u.pagesUsed || 0) / (u.pageLimit || 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold">{u.pagesUsed || 0}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[10px] text-stone-500">
                    <div className="flex flex-col">
                      <span>أسئلة: {u.questionsCount || 0}</span>
                      <span>تصحيح: {u.gradingsCount || 0}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <select 
                      value={u.pageLimit}
                      onChange={(e) => updateUserLimit(u.uid, Number(e.target.value))}
                      className="w-28 bg-stone-50 px-3 py-1.5 rounded-lg border border-stone-200 text-xs outline-none focus:ring-2 focus:ring-emerald-500 text-center font-bold cursor-pointer"
                    >
                      <option value="100">100 صفحة</option>
                      <option value="500">500 صفحة</option>
                      <option value="1000">1000 صفحة</option>
                      <option value="1500">1500 صفحة</option>
                      <option value="2000">2000 صفحة</option>
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <button 
                      onClick={() => deleteUser(u.uid)}
                      className="text-red-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile/Tablet Cards */}
        <div className="lg:hidden space-y-4">
          {users.map(u => (
            <div key={u.uid} className={cn("bg-white p-5 rounded-3xl border shadow-sm space-y-4", u.isNew ? "border-blue-200 bg-blue-50/10" : "border-stone-200")}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn("w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center font-bold", u.isNew ? "bg-blue-100 text-blue-600" : "bg-stone-100 text-stone-400")}>
                    {u.displayName?.charAt(0) || u.email?.charAt(0) || '?'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm">{u.displayName || 'بدون اسم'}</p>
                      {u.isNew && <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded text-[8px] font-bold">جديد</span>}
                    </div>
                    <p className="text-[10px] text-stone-400">{u.email}</p>
                    <p className="text-[9px] text-stone-400 mt-0.5">انضم: {u.createdAt ? new Date(u.createdAt.seconds * 1000).toLocaleDateString('ar-EG') : '-'}</p>
                  </div>
                </div>
                <button 
                  onClick={() => deleteUser(u.uid)}
                  className="p-2 text-red-400 hover:bg-red-50 rounded-xl transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 py-3 border-y border-stone-50">
                <div>
                  <p className="text-[9px] text-stone-400 mb-0.5">الاستهلاك</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-stone-100 rounded-full overflow-hidden">
                      <div 
                        className={cn("h-full", (u.pagesUsed / u.pageLimit) > 0.9 ? "bg-red-500" : "bg-emerald-500")}
                        style={{ width: `${Math.min(100, (u.pagesUsed / u.pageLimit) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold">{u.pagesUsed || 0}</span>
                  </div>
                </div>
                <div className="flex items-center justify-around border-r border-stone-100">
                  <div className="text-center">
                    <p className="text-[9px] text-stone-400 mb-0.5">أسئلة</p>
                    <p className="text-xs font-bold">{u.questionsCount || 0}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[9px] text-stone-400 mb-0.5">تصحيح</p>
                    <p className="text-xs font-bold">{u.gradingsCount || 0}</p>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center justify-between gap-4 text-right" dir="rtl">
                <div className="flex-1">
                  <p className="text-[10px] text-stone-400 mb-1 font-bold">الحد المسموح</p>
                  <select 
                    value={u.pageLimit}
                    onChange={(e) => updateUserLimit(u.uid, Number(e.target.value))}
                    className="w-full bg-stone-50 px-3 py-2 rounded-xl border border-stone-200 text-xs outline-none font-bold cursor-pointer"
                  >
                    <option value="100">100 صفحة</option>
                    <option value="500">500 صفحة</option>
                    <option value="1000">1000 صفحة</option>
                    <option value="1500">1500 صفحة</option>
                    <option value="2000">2000 صفحة</option>
                  </select>
                </div>
              </div>
              {u.isNew && (
                <button 
                  onClick={() => acknowledgeNewUser(u.uid)}
                  className="w-full bg-blue-600 text-white px-5 py-2 rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  تمييز كمقروء
                </button>
              )}
            </div>
          ))}
        </div>

        {users.length === 0 && (
          <div className="bg-stone-50 p-12 rounded-3xl border border-dashed border-stone-200 text-center text-stone-400 text-sm">
            لا يوجد أعضاء مسجلين حالياً
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ImageUpload({ 
  label, 
  value, 
  onChange, 
  onRemove,
  compact = false
}: { 
  label: string, 
  value?: string, 
  onChange: (base64: string) => void, 
  onRemove: () => void,
  compact?: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onChange(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className={cn("space-y-1", compact ? "w-12" : "w-full")}>
      {!compact && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-stone-400">{label}</span>
          {value && (
            <button 
              onClick={onRemove}
              className="text-[10px] text-red-500 hover:underline"
            >
              حذف
            </button>
          )}
        </div>
      )}
      {value ? (
        <div className="relative group/img">
          <img 
            src={value} 
            alt={label} 
            className={cn("object-cover rounded-lg border border-stone-200", compact ? "w-10 h-10" : "w-full h-24")}
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2 rounded-lg">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 bg-white/20 hover:bg-white/40 rounded-lg transition-colors"
              title="تغيير من الجهاز"
            >
              <ImageIcon className={cn("text-white", compact ? "w-3 h-3" : "w-5 h-5")} />
            </button>
            <button 
              onClick={() => cameraInputRef.current?.click()}
              className="p-1.5 bg-white/20 hover:bg-white/40 rounded-lg transition-colors"
              title="تغيير من الكاميرا"
            >
              <Camera className={cn("text-white", compact ? "w-3 h-3" : "w-5 h-5")} />
            </button>
          </div>
          {compact && (
            <button 
              onClick={onRemove}
              className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover/img:opacity-100 transition-opacity"
            >
              <XCircle className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      ) : (
        <div className={cn("flex gap-2", compact ? "flex-col" : "flex-row")}>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed border-stone-200 rounded-lg flex items-center justify-center gap-2 text-stone-400 hover:border-emerald-500 hover:text-emerald-500 transition-all",
              compact ? "w-10 h-10" : "flex-1 h-10"
            )}
            title="رفع من الجهاز"
          >
            <ImageIcon className={cn(compact ? "w-3 h-3" : "w-4 h-4")} />
            {!compact && <span className="text-[10px]">الجهاز</span>}
          </button>
          <button 
            onClick={() => cameraInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed border-stone-200 rounded-lg flex items-center justify-center gap-2 text-stone-400 hover:border-emerald-500 hover:text-emerald-500 transition-all",
              compact ? "w-10 h-10" : "flex-1 h-10"
            )}
            title="فتح الكاميرا"
          >
            <Camera className={cn(compact ? "w-3 h-3" : "w-4 h-4")} />
            {!compact && <span className="text-[10px]">الكاميرا</span>}
          </button>
        </div>
      )}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept="image/*" 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={cameraInputRef} 
        onChange={handleFileChange} 
        accept="image/*" 
        capture="environment"
        className="hidden" 
      />
    </div>
  );
}

function NavButton({ active, onClick, icon, label, mobile = false }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, mobile?: boolean }) {
  return (
    <button 
      onClick={onClick}
      translate="no"
      className={cn(
        "flex items-center transition-all",
        mobile 
          ? "flex-col gap-1 px-2 py-1 flex-1" 
          : "gap-2 px-4 py-2 rounded-xl text-sm font-medium",
        active 
          ? (mobile ? "text-emerald-600" : "bg-emerald-50 text-emerald-700") 
          : "text-stone-500 hover:bg-stone-100"
      )}
    >
      <div className={cn(mobile && "p-1 rounded-lg", active && mobile && "bg-emerald-50")}>
        {icon}
      </div>
      <span className={cn(mobile ? "text-[10px] font-bold" : "text-sm")}>{label}</span>
    </button>
  );
}

function StatCard({ icon, label, value, color, description }: { icon: React.ReactNode, label: string, value: string | number, color: string, description?: string }) {
  const colorMap: any = {
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100",
    purple: "bg-purple-50 text-purple-600 border-purple-100"
  };

  return (
    <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm space-y-2">
      <div className="flex items-center gap-3">
        <div className={cn("p-2 rounded-xl border", colorMap[color] || "bg-stone-50 border-stone-100")}>
          {icon}
        </div>
        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-2xl font-bold text-stone-900">{value}</span>
        {description && <span className="text-[9px] text-stone-400">{description}</span>}
      </div>
    </div>
  );
}

function Dashboard({ exams, userProfile, onNewExam, onGrade, onEditExam, onDeleteExam }: any) {
  const totalQuestions = exams.reduce((acc: number, exam: any) => acc + (exam.questions?.length || 0), 0);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold font-serif italic mb-1">مرحباً بك مجدداً</h2>
          <p className="text-sm md:text-base text-stone-500">إليك نظرة سريعة على نشاطك الحالي</p>
        </div>
        <button 
          onClick={onNewExam}
          translate="no"
          className="bg-emerald-600 text-white px-6 py-3 rounded-2xl font-medium flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20 w-full md:w-auto"
        >
          <Plus className="w-5 h-5" />
          امتحان جديد
        </button>
      </div>

      {/* User Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard 
          icon={<FileText className="w-5 h-5 text-emerald-600" />} 
          label="الامتحانات" 
          value={exams.length} 
          color="emerald" 
        />
        <StatCard 
          icon={<CheckSquare className="w-5 h-5 text-blue-600" />} 
          label="إجمالي الأسئلة" 
          value={totalQuestions} 
          color="blue" 
          description="في كل امتحاناتك"
        />
        <StatCard 
          icon={<Layers className="w-5 h-5 text-amber-600" />} 
          label="أسئلة مستخرجة" 
          value={userProfile?.questionsCount || 0} 
          color="amber" 
          description="إجمالي الاستخراج الذكي"
        />
        <StatCard 
          icon={<CheckCircle className="w-5 h-5 text-purple-600" />} 
          label="أوراق مصححة" 
          value={userProfile?.gradingsCount || 0} 
          color="purple" 
          description="إجمالي التقديرات"
        />
      </div>

      <div className="bg-stone-50 border border-stone-200 p-6 rounded-3xl flex flex-col md:flex-row items-center gap-6 justify-between">
        <div className="space-y-1 text-center md:text-right">
          <h3 className="font-bold text-stone-800">هل تحتاج مساعدة في التفعيل؟</h3>
          <p className="text-sm text-stone-500">تواصل معنا لتفعيل حسابك أو لطلب الدعم الفني</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
          <a href="tel:07706118992" className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-white border border-stone-200 px-6 py-3 rounded-xl font-bold hover:bg-stone-100 transition-all shadow-sm">
            <Phone className="w-4 h-4 text-emerald-600" />
            <span dir="ltr">07706118992</span>
          </a>
          <a href="https://wa.me/9647706118992" target="_blank" rel="noreferrer" translate="no" className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-[#25D366] text-white px-6 py-3 rounded-xl font-bold hover:opacity-90 transition-all shadow-sm">
            <MessageCircle className="w-4 h-4" />
            واتساب الدعم
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {exams.map((exam: any) => (
          <div key={exam.id} className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm hover:shadow-md transition-shadow group">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-stone-100 rounded-2xl flex items-center justify-center text-stone-600 group-hover:bg-emerald-50 group-hover:text-emerald-600 transition-colors">
                <FileText className="w-6 h-6" />
              </div>
              <button onClick={() => onDeleteExam(exam.id)} className="p-2 text-stone-300 hover:text-red-500 transition-colors">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
            <h3 className="text-xl font-bold mb-2">{exam.title}</h3>
            <div className="flex items-center gap-4 text-sm text-stone-500 mb-6">
              <span className="flex items-center gap-1"><CheckSquare className="w-4 h-4" /> {exam.questions.length} أسئلة</span>
              <span className="flex items-center gap-1"><Settings className="w-4 h-4" /> الدرجة: {exam.totalGrade}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => onGrade(exam)}
                className="bg-stone-100 text-stone-900 py-3 rounded-xl font-medium hover:bg-emerald-600 hover:text-white transition-all flex items-center justify-center gap-2"
              >
                <FileUp className="w-4 h-4" />
                بدء التصحيح
              </button>
              <button 
                onClick={() => onEditExam(exam)}
                className="bg-stone-100 text-stone-900 py-3 rounded-xl font-medium hover:bg-stone-200 transition-all flex items-center justify-center gap-2"
              >
                <Settings className="w-4 h-4" />
                تعديل
              </button>
            </div>
          </div>
        ))}
        {exams.length === 0 && (
          <div className="col-span-full py-20 text-center bg-white rounded-3xl border-2 border-dashed border-stone-200">
            <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <HelpCircle className="w-8 h-8 text-stone-300" />
            </div>
            <p className="text-stone-400">لا توجد امتحانات حالياً. ابدأ بإنشاء أول امتحان لك!</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ExamCreator({ user, userProfile, initialData, onSave, onCancel }: any) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [duration, setDuration] = useState(initialData?.duration || '');
  const [study, setStudy] = useState(initialData?.study || 'الإعدادية / العلمي');
  const [round, setRound] = useState(initialData?.round || 'الدور الأول');
  const [totalGrade, setTotalGrade] = useState(initialData?.totalGrade || 100);
  const [requiredQuestionsCount, setRequiredQuestionsCount] = useState<number | null>(initialData?.requiredQuestionsCount || null);
  const [questions, setQuestions] = useState<Question[]>(initialData?.questions || []);
  const [isSaving, setIsSaving] = useState(false);
  const [savingStatus, setSavingStatus] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const [printMode, setPrintMode] = useState<'questions' | 'both'>('questions');
  const [extractionImages, setExtractionImages] = useState<string[]>([]);
  const [dualQImages, setDualQImages] = useState<string[]>([]);
  const [dualAImages, setDualAImages] = useState<string[]>([]);
  const [extractionMode, setExtractionMode] = useState<'single' | 'dual' | 'manual' | null>(null);

  const extractionInputRef = useRef<HTMLInputElement>(null);
  const extractionCameraInputRef = useRef<HTMLInputElement>(null);
  const dualQInputRef = useRef<HTMLInputElement>(null);
  const dualAInputRef = useRef<HTMLInputElement>(null);
  const examPrintRef = useRef<HTMLDivElement>(null);
  const examFullPrintRef = useRef<HTMLDivElement>(null);

  const uploadImageToStorage = async (base64: string, path: string) => {
    if (!base64 || !base64.startsWith('data:image')) return base64;
    
    setSavingStatus('جاري رفع الصور...');
    console.log(`[Storage] Starting upload to: ${path}`);
    try {
      const storageRef = ref(storage, path);
      
      // Convert base64 to Blob for more reliable upload
      const response = await fetch(base64);
      const blob = await response.blob();
      
      // Add a timeout to the upload
      const uploadPromise = uploadBytes(storageRef, blob);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Upload timeout')), 45000)
      );
      
      await Promise.race([uploadPromise, timeoutPromise]);
      
      const url = await getDownloadURL(storageRef);
      console.log(`[Storage] Upload successful: ${url}`);
      return url;
    } catch (error) {
      console.error(`[Storage] Error uploading image to ${path}:`, error);
      // Fallback to base64 so the save can at least attempt to proceed
      return base64; 
    }
  };

  const processQuestionsForStorage = async (qs: Question[]): Promise<Question[]> => {
    if (!qs || qs.length === 0) return [];
    
    const processed = [];
    console.log(`[Storage] Processing ${qs.length} questions...`);
    
    let count = 0;
    for (const q of qs) {
      count++;
      setSavingStatus(`جاري معالجة السؤال ${count} من ${qs.length}...`);
      const newQ = { ...q };
      
      // 1. Process sub-questions recursively
      if (q.subQuestions && q.subQuestions.length > 0) {
        newQ.subQuestions = await processQuestionsForStorage(q.subQuestions);
      } else {
        newQ.subQuestions = [];
      }
      
      // 2. Upload images for the current question in parallel
      const uploadTasks = [];
      
      if (q.questionImage && q.questionImage.startsWith('data:image')) {
        uploadTasks.push(
          uploadImageToStorage(q.questionImage, `exams/${user.uid}/${q.id}_q_${Date.now()}`)
            .then(url => { newQ.questionImage = url; })
        );
      }
      
      if (q.answerImage && q.answerImage.startsWith('data:image')) {
        uploadTasks.push(
          uploadImageToStorage(q.answerImage, `exams/${user.uid}/${q.id}_a_${Date.now()}`)
            .then(url => { newQ.answerImage = url; })
        );
      }
      
      if (uploadTasks.length > 0) {
        await Promise.all(uploadTasks);
      }
      
      processed.push(newQ);
    }
    
    return processed;
  };

  const handleExtractionFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      const readers = files.map(file => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      });

      Promise.all(readers).then(results => {
        setExtractionImages(prev => [...prev, ...results]);
      });
    }
  };

  const handleExtract = async () => {
    if (extractionMode === 'single' && extractionImages.length === 0) return;
    if (extractionMode === 'dual' && (dualQImages.length === 0 || dualAImages.length === 0)) {
      alert('يرجى اختيار صور الأسئلة والأجوبة معاً');
      return;
    }

    setIsExtracting(true);
    try {
      let result;
      if (extractionMode === 'single') {
        result = await extractExamFromImages(extractionImages);
      } else {
        result = await extractExamFromDualImages(dualQImages, dualAImages);
      }

      console.log('Extraction result:', result);
      
      if (result.title) setTitle(result.title);
      if (result.requiredQuestionsCount) setRequiredQuestionsCount(result.requiredQuestionsCount);
      
      if (result.questions && result.questions.length > 0) {
        // Update user usage stats
        if (userProfile) {
          const totalPages = extractionMode === 'single' ? extractionImages.length : (dualQImages.length + dualAImages.length);
          try {
            await updateDoc(doc(db, 'users', user.uid), {
              pagesUsed: increment(totalPages),
              questionsCount: increment(result.questions?.length || 0)
            });
          } catch (e) {
            handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`);
          }
        }

        const cleanAllQuestionsText = (qs: Question[]): Question[] => {
          return qs.map(q => ({
            ...q,
            text: cleanQuestionText(q.text),
            subQuestions: q.subQuestions ? cleanAllQuestionsText(q.subQuestions) : []
          }));
        };

        const ensureIds = (qs: Question[]): Question[] => {
          return qs.map(q => ({
            ...q,
            id: q.id || Math.random().toString(36).substr(2, 9),
            subQuestions: q.subQuestions ? ensureIds(q.subQuestions) : []
          }));
        };
        setQuestions(ensureIds(cleanAllQuestionsText(result.questions)));
        alert('تم استخراج الأسئلة والأجوبة بنجاح');
      } else {
        alert('تمت المعالجة ولكن لم يتم العثور على بيانات واضحة. يرجى التأكد من جودة الصور.');
      }
      
      setExtractionImages([]);
      setDualQImages([]);
      setDualAImages([]);
      setExtractionMode(null);
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء استخراج البيانات');
    } finally {
      setIsExtracting(false);
    }
  };

  const addQuestion = () => {
    setQuestions([...questions, {
      id: Math.random().toString(36).substr(2, 9),
      text: '',
      answer: '',
      grade: 0,
      type: 'text',
      subQuestions: []
    }]);
  };

  const addSubQuestion = (parentId: string, subParentId?: string, style?: 'numbers' | 'letters') => {
    setQuestions(questions.map(q => {
      if (q.id === parentId) {
        if (subParentId) {
          // Level 3: Adding a point to a branch
          return {
            ...q,
            subQuestions: q.subQuestions?.map(sq => {
              if (sq.id === subParentId) {
                return {
                  ...sq,
                  subStyle: style || 'numbers',
                  subQuestions: [...(sq.subQuestions || []), {
                    id: Math.random().toString(36).substr(2, 9),
                    text: '',
                    answer: '',
                    grade: 0,
                    type: 'text'
                  }]
                };
              }
              return sq;
            })
          };
        }
        // Level 2: Adding a branch or point to a main question
        const subQs = q.subQuestions || [];
        return {
          ...q,
          subStyle: style || q.subStyle || 'numbers',
          subQuestions: [...subQs, {
            id: Math.random().toString(36).substr(2, 9),
            text: '',
            answer: '',
            grade: 0,
            type: 'text',
            subQuestions: []
          }]
        };
      }
      return q;
    }));
  };

  const updateQuestion = (id: string, updates: Partial<Question>, parentId?: string, subParentId?: string) => {
    if (subParentId && parentId) {
      // Level 3 update
      setQuestions(questions.map(q => {
        if (q.id === parentId) {
          return {
            ...q,
            subQuestions: q.subQuestions?.map(sq => {
              if (sq.id === subParentId) {
                return {
                  ...sq,
                  subQuestions: sq.subQuestions?.map(ssq => ssq.id === id ? { ...ssq, ...updates } : ssq)
                };
              }
              return sq;
            })
          };
        }
        return q;
      }));
    } else if (parentId) {
      // Level 2 update
      setQuestions(questions.map(q => {
        if (q.id === parentId) {
          return {
            ...q,
            subQuestions: q.subQuestions?.map(sq => sq.id === id ? { ...sq, ...updates } : sq)
          };
        }
        return q;
      }));
    } else {
      // Level 1 update
      setQuestions(questions.map(q => q.id === id ? { ...q, ...updates } : q));
    }
  };

  const removeQuestion = (id: string, parentId?: string, subParentId?: string) => {
    if (subParentId && parentId) {
      // Level 3 remove
      setQuestions(questions.map(q => {
        if (q.id === parentId) {
          return {
            ...q,
            subQuestions: q.subQuestions?.map(sq => {
              if (sq.id === subParentId) {
                return {
                  ...sq,
                  subQuestions: sq.subQuestions?.filter(ssq => ssq.id !== id)
                };
              }
              return sq;
            })
          };
        }
        return q;
      }));
    } else if (parentId) {
      // Level 2 remove
      setQuestions(questions.map(q => {
        if (q.id === parentId) {
          return {
            ...q,
            subQuestions: q.subQuestions?.filter(sq => sq.id !== id)
          };
        }
        return q;
      }));
    } else {
      // Level 1 remove
      setQuestions(questions.filter(q => q.id !== id));
    }
  };

  const saveExam = async () => {
    if (!title || questions.length === 0) {
      if (extractionMode === 'dual' && (dualQImages.length > 0 || dualAImages.length > 0)) {
        if (dualQImages.length === 0 || dualAImages.length === 0) {
          alert('يرجى رفع صور الأسئلة والأجوبة معاً لإتمام العملية بنجاح');
          return;
        }
      }
      return alert('يرجى إدخال عنوان الامتحان وسؤال واحد على الأقل، أو استكمال استخراج الأسئلة من الصور');
    }
    setIsSaving(true);
    setSavingStatus('جاري التحضير للحفظ...');
    try {
      const processedQuestions = await processQuestionsForStorage(questions);
      
      setSavingStatus('جاري حفظ البيانات في قاعدة البيانات...');
      const examData = {
        title,
        duration,
        study,
        round,
        totalGrade,
        requiredQuestionsCount: requiredQuestionsCount || questions.length,
        questions: processedQuestions,
        authorUid: user.uid,
        updatedAt: serverTimestamp()
      };

      if (initialData?.id) {
        try {
          await updateDoc(doc(db, 'exams', initialData.id), examData);
        } catch (e) {
          handleFirestoreError(e, OperationType.UPDATE, `exams/${initialData.id}`);
        }
      } else {
        try {
          // If manual mode, update questionsCount as it wasn't updated during extraction
          if (extractionMode === 'manual' || !extractionMode) {
            await updateDoc(doc(db, 'users', user.uid), {
              questionsCount: increment(questions.length)
            });
          }
          await addDoc(collection(db, 'exams'), {
            ...examData,
            createdAt: serverTimestamp()
          });
        } catch (e) {
          handleFirestoreError(e, OperationType.CREATE, 'exams');
        }
      }
      onSave();
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء الحفظ. قد يكون حجم الصور كبيراً جداً.');
    } finally {
      setIsSaving(false);
    }
  };

  const printExam = async (mode: 'questions' | 'both') => {
    const ref = mode === 'questions' ? examPrintRef : examFullPrintRef;
    if (!ref.current) return;
    
    setIsPrinting(true);
    try {
      // Add padding to ensure content is not cut off and has nice margins
      await generatePDFFromElement(ref.current, `${title || 'exam'}_${mode}.pdf`, { 
        useElementWidth: true,
        padding: '15mm' 
      });
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-4xl mx-auto space-y-8 px-0.5 sm:px-0"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4" data-html2canvas-ignore>
        <h2 className="text-2xl md:text-3xl font-bold font-serif italic">
          {initialData ? 'تعديل الامتحان' : 'إنشاء امتحان جديد'}
        </h2>
        <div className="flex gap-2 w-full md:w-auto">
          <button onClick={onCancel} className="flex-1 md:flex-none px-6 py-2 rounded-xl text-stone-500 hover:bg-stone-100 transition-colors">إلغاء</button>
          {questions.length > 0 && (
            <div className="flex gap-2 flex-grow md:flex-grow-0">
               <div className="relative">
                <button 
                  onClick={() => setShowPrintMenu(!showPrintMenu)}
                  className="w-full md:w-auto px-4 py-2 rounded-xl bg-stone-100 text-stone-600 flex items-center justify-center gap-2 hover:bg-stone-200 transition-all font-bold text-sm"
                >
                  <Printer className="w-4 h-4" />
                  <span className="hidden sm:inline">تحميل PDF</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showPrintMenu ? 'rotate-180' : ''}`} />
                </button>
                {showPrintMenu && (
                  <div className="absolute top-full left-0 mt-2 bg-white rounded-2xl border border-stone-200 shadow-xl overflow-hidden z-50 w-48">
                    <button 
                      onClick={() => { printExam('questions'); setShowPrintMenu(false); }}
                      className="w-full text-right px-4 py-3 hover:bg-stone-50 transition-colors flex items-center gap-3 border-b border-stone-100 text-sm"
                    >
                      <FileText className="w-4 h-4 text-stone-400" />
                      تحميل الأسئلة فقط
                    </button>
                    <button 
                      onClick={() => { printExam('both'); setShowPrintMenu(false); }}
                      className="w-full text-right px-4 py-3 hover:bg-stone-50 transition-colors flex items-center gap-3 text-sm"
                    >
                      <BookOpen className="w-4 h-4 text-emerald-400" />
                      الأسئلة والأجوبة
                    </button>
                  </div>
                )}
              </div>
               <button 
                onClick={saveExam}
                disabled={isSaving}
                className="flex-1 md:flex-none bg-emerald-600 text-white px-6 md:px-8 py-2 rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Structured Extraction Options */}
      {!initialData && questions.length === 0 && !extractionMode && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" data-html2canvas-ignore>
          <button 
            onClick={() => {
              setExtractionMode('dual');
              setDualQImages([]);
              setDualAImages([]);
            }}
            className="flex flex-col items-center gap-4 p-6 bg-emerald-50 border-2 border-emerald-100 rounded-3xl hover:border-emerald-300 hover:bg-emerald-100/50 transition-all text-right group ring-1 ring-emerald-200"
          >
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
              <Layers className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="font-bold text-emerald-900 mb-1 leading-tight">الخيار الأول: (أسئلة + أجوبة) منفصلة</p>
              <p className="text-[11px] text-emerald-700 leading-relaxed">استخراج من صورتين مختلفتين، صورة لورقة الأسئلة وصورة لورقة الأجوبة النموذجية.</p>
            </div>
          </button>

          <button 
            onClick={() => {
              setExtractionMode('single');
              extractionInputRef.current?.click();
            }}
            className="flex flex-col items-center gap-4 p-6 bg-stone-50 border-2 border-stone-100 rounded-3xl hover:border-emerald-300 hover:bg-white transition-all text-right group"
          >
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
              <FileUp className="w-6 h-6 text-stone-600" />
            </div>
            <div>
              <p className="font-bold text-stone-900 mb-1 leading-tight">الخيار الثاني: ورقة (سؤال وجواب)</p>
              <p className="text-[11px] text-stone-500 leading-relaxed">يرفع صورة واحدة لكل سؤال وتحته الجواب، سيتم الربط تلقائياً.</p>
            </div>
          </button>

          <button 
            onClick={() => {
              setExtractionMode('single');
              extractionCameraInputRef.current?.click();
            }}
            className="flex flex-col items-center gap-4 p-6 bg-stone-50 border-2 border-stone-100 rounded-3xl hover:border-emerald-300 hover:bg-white transition-all text-right group"
          >
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
              <Camera className="w-6 h-6 text-stone-600" />
            </div>
            <div>
              <p className="font-bold text-stone-900 mb-1 leading-tight">الخيار الثالث: الفتح السريع (الكاميرا)</p>
              <p className="text-[11px] text-stone-500 leading-relaxed">تصوير ورقة الامتحان والأجوبة بشكل هجين وسريع ومباشر عبر كاميرا الجهاز.</p>
            </div>
          </button>

          <button 
            onClick={() => setExtractionMode('manual')}
            className="flex flex-col items-center gap-4 p-6 bg-blue-50 border-2 border-blue-100 rounded-3xl hover:border-blue-300 hover:bg-white transition-all text-right group"
          >
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
              <PlusCircle className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-blue-900 mb-1 leading-tight">الخيار الرابع: إضافة يدوية</p>
              <p className="text-[11px] text-blue-500 leading-relaxed">كتابة الأسئلة والأجوبة وتحديد الدرجات يدوياً دون الحاجة لاستخراج من الصور.</p>
            </div>
          </button>
        </div>
      )}

      {/* Hidden file inputs moved here for better management */}
      <div className="hidden">
        <input type="file" ref={extractionInputRef} onChange={handleExtractionFileChange} accept="image/*" multiple />
        <input type="file" ref={extractionCameraInputRef} onChange={handleExtractionFileChange} accept="image/*" capture="environment" />
        <input type="file" ref={dualQInputRef} onChange={(e) => {
          const files = Array.from(e.target.files || []);
          Promise.all(files.map(f => new Promise<string>(r => {
            const fr = new FileReader(); fr.onloadend = () => r(fr.result as string); fr.readAsDataURL(f);
          }))).then(res => setDualQImages(prev => [...prev, ...res]));
        }} accept="image/*" multiple />
        <input type="file" ref={dualAInputRef} onChange={(e) => {
          const files = Array.from(e.target.files || []);
          Promise.all(files.map(f => new Promise<string>(r => {
            const fr = new FileReader(); fr.onloadend = () => r(fr.result as string); fr.readAsDataURL(f);
          }))).then(res => setDualAImages(prev => [...prev, ...res]));
        }} accept="image/*" multiple />
      </div>
      {/* Extraction Image Previews and Final Processing Card */}
      {(extractionImages.length > 0 || extractionMode === 'dual') && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 space-y-4"
          data-html2canvas-ignore
        >
          {extractionMode === 'single' ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-emerald-800 font-bold flex items-center gap-2">
                  <ImageIcon className="w-5 h-5" />
                  صور جاهزة للاستخراج ({extractionImages.length})
                </h3>
                <div className="flex gap-2">
                  <button 
                    onClick={() => { setExtractionImages([]); setExtractionMode(null); }}
                    className="text-stone-500 text-sm hover:underline"
                  >
                    إلغاء الكل
                  </button>
                  <button 
                    onClick={handleExtract}
                    disabled={isExtracting}
                    className="bg-emerald-600 text-white px-6 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {isExtracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    بدء الاستخراج الذكي (أسئلة فقط)
                  </button>
                </div>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {extractionImages.map((img, i) => (
                  <div key={i} className="relative flex-shrink-0">
                    <img src={img} alt="" className="w-24 h-24 object-cover rounded-xl border border-emerald-200" crossOrigin="anonymous" />
                    <button 
                      onClick={() => setExtractionImages(prev => prev.filter((_, idx) => idx !== i))}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-lg"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-emerald-800 font-bold flex items-center gap-2">
                  <Layers className="w-5 h-5" />
                  استخراج الأسئلة والأجوبة معاً
                </h3>
                <button 
                  onClick={() => { setExtractionMode(null); setDualQImages([]); setDualAImages([]); }}
                  className="text-stone-500 text-sm hover:underline"
                >
                  إلغاء
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Questions Box */}
                <div className="bg-white p-4 rounded-2xl border-2 border-dashed border-stone-200 hover:border-emerald-300 transition-colors cursor-pointer" onClick={() => dualQInputRef.current?.click()}>
                  <div className="text-center space-y-2 mb-4">
                    <Plus className="w-6 h-6 mx-auto text-stone-400" />
                    <p className="font-bold text-stone-600">صور الأسئلة</p>
                    <p className="text-[10px] text-stone-400">({dualQImages.length} صور محملة)</p>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {dualQImages.map((img, i) => (
                      <img key={i} src={img} className="w-12 h-12 object-cover rounded-lg border border-stone-100" />
                    ))}
                  </div>
                </div>

                {/* Answers Box */}
                <div className="bg-white p-4 rounded-2xl border-2 border-dashed border-stone-200 hover:border-emerald-300 transition-colors cursor-pointer" onClick={() => dualAInputRef.current?.click()}>
                  <div className="text-center space-y-2 mb-4">
                    <Plus className="w-6 h-6 mx-auto text-stone-400" />
                    <p className="font-bold text-stone-600">صور الأجوبة النموذجية</p>
                    <p className="text-[10px] text-stone-400">({dualAImages.length} صور محملة)</p>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {dualAImages.map((img, i) => (
                      <img key={i} src={img} className="w-12 h-12 object-cover rounded-lg border border-stone-100" />
                    ))}
                  </div>
                </div>
              </div>

              <button 
                onClick={handleExtract}
                disabled={isExtracting || dualQImages.length === 0 || dualAImages.length === 0}
                className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isExtracting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                بدء استخراج الأسئلة والأجوبة معاً
              </button>
            </div>
          )}
        </motion.div>
      )}

      {/* Meta Section - Conditioned on Mode/Extraction Success */}
      {(extractionMode === 'manual' || (questions.length > 0 && !isExtracting)) && (
        <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6 animate-in fade-in duration-500">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6" data-html2canvas-ignore>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-500">عنوان الامتحان / المادة</label>
            <input 
              type="text"
              value={title} 
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: الكيمياء"
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-500">الدراسة</label>
            <input 
              type="text" 
              value={study} 
              onChange={(e) => setStudy(e.target.value)}
              placeholder="مثال: الإعدادية / العلمي"
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-500">الدور</label>
            <input 
              type="text" 
              value={round} 
              onChange={(e) => setRound(e.target.value)}
              placeholder="مثال: الدور الأول"
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
          
          {/* Show structural fields ONLY if manual mode OR AI questions-only (no answers) */}
          {(extractionMode === 'manual' || !questions.some(q => q.answer)) && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-500">الدرجة الكلية</label>
                <input 
                  type="number" 
                  value={totalGrade} 
                  onChange={(e) => setTotalGrade(Number(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-500">عدد الأسئلة المطلوب حلها</label>
                <input 
                  type="number" 
                  value={requiredQuestionsCount || ''} 
                  onChange={(e) => setRequiredQuestionsCount(e.target.value ? Number(e.target.value) : null)}
                  placeholder={`الافتراضي: ${questions.length || 0}`}
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-500">الوقت (مثلاً: ثلاث ساعات)</label>
                <input 
                  type="text" 
                  value={duration} 
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="الوقت المخصص"
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>
            </>
          )}
        </div>
      </div>
    )}

      {/* Official Exam Header for PDF (Questions Only) */}
        <div className="fixed left-[-9999px] top-0 w-[210mm] pdf-export-container" ref={examPrintRef}>
          <div className="px-[20mm] py-[25mm] bg-white space-y-8 text-right" dir="rtl" style={{ boxSizing: 'border-box' }}>
            <div className="flex justify-between items-start border-b-2 border-stone-900 pb-6">
              <div className="space-y-1">
                <p className="font-bold text-lg">وزارة التربية</p>
                <p>الدراسة: {study}</p>
                <p>المادة: {title}</p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 border-2 border-stone-900 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-[10px] font-bold">شعار الوزارة</span>
                </div>
                <p className="font-bold">جمهورية العراق</p>
                <p>{round} / {new Date().getFullYear()} - {new Date().getFullYear() + 1}</p>
                <p>الوقت: {duration || 'غير محدد'}</p>
              </div>
              <div className="space-y-1">
                <p className="font-bold pt-12">اسم الطالب: ........................................</p>
              </div>
            </div>

            <div className="bg-stone-100 p-4 rounded-lg border border-stone-200">
              <p className="font-bold">ملاحظة: الإجابة عن {requiredQuestionsCount || questions.length} أسئلة فقط، ولكل سؤال {Math.round(totalGrade / (requiredQuestionsCount || questions.length))} درجة.</p>
            </div>

            <div className="space-y-10">
              {questions.map((q, idx) => (
                <div key={q.id} className="space-y-4">
                  <div className="flex justify-between items-start">
                    <h4 className="text-xl font-bold leading-relaxed">س{idx + 1}: {cleanQuestionText(q.text)}</h4>
                    <span className="font-bold">({formatGrade(q.grade)} درجة)</span>
                  </div>
                  {q.questionImage && <img src={q.questionImage} className="max-h-64 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
                  
                  {(q.answer || q.answerImage) && (
                    <div className="text-emerald-700 bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 mb-6">
                      <p className="font-bold mb-1 underline">الإجابة النموذجية:</p>
                      {q.answer && <p className="whitespace-pre-wrap">{q.answer}</p>}
                      {q.answerImage && <img src={q.answerImage} className="mt-2 max-h-64 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
 
