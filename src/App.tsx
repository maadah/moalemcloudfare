// Smart Grader - AI Powered Exam System (Netlify Optimized)
import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Trash2, Save, FileText, Upload, CheckCircle, 
  X, XCircle, ChevronDown, ChevronUp, Download, LogIn, 
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
import { Question, gradeStudentPaper, gradeMathDirect, extractExamFromImages, extractExamFromDualImages, ensureTwoLevelHierarchy, testApiConnection } from './services/geminiService';
import jsPDF from 'jspdf';

const ARABIC_BRANCH_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isPlainObject = (val: any) => {
  if (val === null || typeof val !== 'object') return false;
  const proto = Object.getPrototypeOf(val);
  return proto === null || proto === Object.prototype;
};

export const removeUndefinedFields = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedFields);
  } else if (obj !== null && typeof obj === 'object' && isPlainObject(obj)) {
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val !== undefined) {
        cleaned[key] = removeUndefinedFields(val);
      }
    }
    return cleaned;
  }
  return obj;
};

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

type View = 'dashboard' | 'create-exam' | 'grade-papers' | 'results' | 'admin' | 'math-direct';

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

function cleanQuestionText(text: string, label?: string, isTopLevel: boolean = false) {
  if (!text) return "";
  let cleaned = text.trim();
  
  if (isTopLevel) {
    return cleaned;
  }
  
  // Clean generic question titles like "السؤال الأول", "السؤال الثاني" etc. if they are followed by other text
  const examLabelRegex = /^(السؤال\s+(الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر))\s*[:\-\s]*/;
  if (examLabelRegex.test(cleaned)) {
    const withoutPrefix = cleaned.replace(examLabelRegex, '').trim();
    if (withoutPrefix.length > 0) {
      cleaned = withoutPrefix;
    }
  }

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
                value={grading.grade ?? ''} 
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
              {user.email === 'asmaomar5566@gmail.com' && (
                <button 
                  onClick={() => {
                    const current = localStorage.getItem('KIMI_API_KEY_FALLBACK') || localStorage.getItem('GEMINI_API_KEY_FALLBACK') || '';
                    const key = prompt('أدخل مفتاح Kimi (Moonshot) API الجديد (اختياري):', current);
                    if (key !== null) {
                      if (key.trim()) {
                        localStorage.setItem('KIMI_API_KEY_FALLBACK', key.trim());
                        localStorage.removeItem('GEMINI_API_KEY_FALLBACK');
                        alert('تم حفظ المفتاح بنجاح.');
                      } else {
                        localStorage.removeItem('KIMI_API_KEY_FALLBACK');
                        localStorage.removeItem('GEMINI_API_KEY_FALLBACK');
                        alert('تم مسح المفتاح، سيتم استخدام المفتاح الافتراضي للمنظمة.');
                      }
                    }
                  }}
                  className="p-2 text-stone-400 hover:text-emerald-600 transition-colors"
                  title="إعدادات مفتاح API"
                >
                  <Settings className="w-5 h-5" />
                </button>
              )}
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
              onMathDirect={() => setView('math-direct')}
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
          {view === 'math-direct' && (
            <MathDirectGrader 
              user={user}
              userProfile={userProfile}
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
                      value={u.pageLimit ?? 100}
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
                    value={u.pageLimit ?? 100}
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

function Dashboard({ exams, userProfile, onNewExam, onGrade, onEditExam, onDeleteExam, onMathDirect }: any) {
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState<any>(null);

  const handleTestConnection = async () => {
    setTestStatus('loading');
    setTestResult(null);
    try {
      const res = await testApiConnection();
      if (res.success) {
        setTestStatus('success');
        setTestResult(res);
      } else {
        setTestStatus('error');
        setTestResult(res);
      }
    } catch (err: any) {
      setTestStatus('error');
      setTestResult({
        message: "حدث خطأ غير متوقع أثناء الفحص.",
        errorDetails: err?.message || String(err)
      });
    }
  };

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
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <button 
            onClick={onMathDirect}
            className="bg-sky-600 text-white px-6 py-3 rounded-2xl font-medium flex items-center justify-center gap-2 hover:bg-sky-700 transition-colors shadow-lg shadow-sky-600/10 w-full sm:w-auto"
          >
            <BookOpen className="w-5 h-5 text-sky-200" />
            التصحيح المباشر للرياضيات (بدون حلول نموذجية) 📐
          </button>
          <button 
            onClick={onNewExam}
            translate="no"
            className="bg-emerald-600 text-white px-6 py-3 rounded-2xl font-medium flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20 w-full sm:w-auto"
          >
            <Plus className="w-5 h-5" />
            امتحان جديد
          </button>
        </div>
      </div>

      {/* Test Connection Card */}
      <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-start gap-4 text-right">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
              <Settings className="w-6 h-6 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-lg text-stone-800">التحقق من اتصال Kimi API</h3>
              <p className="text-sm text-stone-500">تحقق بشكل تجريبي من صحة مفتاحك الحالي ومستوى استجابة الذكاء الاصطناعي لتجنب الأخطاء أثناء التصحيح</p>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
            {testStatus !== 'idle' && (
              <div className={cn(
                "text-sm font-medium px-4 py-2.5 rounded-xl border w-full sm:w-auto text-center flex items-center justify-center gap-2",
                testStatus === 'loading' && "bg-stone-50 text-stone-600 border-stone-200",
                testStatus === 'success' && "bg-emerald-50 text-emerald-700 border-emerald-200",
                testStatus === 'error' && "bg-red-50 text-red-700 border-red-200"
              )}>
                {testStatus === 'loading' && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                    <span>جاري فحص الاتصال...</span>
                  </>
                )}
                {testStatus === 'success' && (
                  <>
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <div className="flex flex-col text-right">
                      <span>{testResult?.message}</span>
                      <span className="text-[10px] opacity-75">المفتاح النشط: {testResult?.preview}</span>
                    </div>
                  </>
                )}
                {testStatus === 'error' && (
                  <>
                    <XCircle className="w-4 h-4 text-red-600" />
                    <div className="flex flex-col text-right">
                      <span>{testResult?.message}</span>
                      <span className="text-[10px] opacity-75">المفتاح المفحوص: {testResult?.preview || "غير متوفر"}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              onClick={handleTestConnection}
              disabled={testStatus === 'loading'}
              className="bg-stone-950 text-white hover:bg-stone-800 disabled:opacity-50 transition-colors px-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 shrink-0 w-full sm:w-auto shadow-md"
            >
              {testStatus === 'loading' ? (
                <Loader2 className="w-5 h-5 animate-spin text-white" />
              ) : (
                <CheckSquare className="w-5 h-5 text-emerald-400" />
              )}
              اختبار الاتصال
            </button>
          </div>
        </div>

        {/* Swapped Keys Warning */}
        {testResult?.envScan && testResult.envScan.some((item: any) => item.isSuspiciousSwapped) && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-right space-y-3 mt-4">
            <div className="flex items-center gap-2 text-red-800 font-bold">
              <XCircle className="w-5 h-5 text-red-600 shrink-0" />
              <h4>تنبيه هام جداً: مدخلات الـ Secrets مقلوبة!</h4>
            </div>
            <div className="text-sm text-red-900 space-y-2 pr-2 leading-relaxed">
              <p>لقد لاحظنا أنه عند استيراد المشروع أو إدخال إعدادات الـ Secrets، تَمَّ خلط اسم المتغير (Name) مع قيمته (Value):</p>
              <p>في جدول الـ Secrets المرفوع، تم رصد المدخلات المقلوبة التالية التي وُضعت مكان "الاسم" (Name):</p>
              <div className="space-y-1 mt-2">
                {testResult.envScan.filter((item: any) => item.isSuspiciousSwapped).map((item: any, idx: number) => (
                  <div key={idx} className="bg-white/90 border border-red-100 p-2.5 rounded-xl font-mono text-xs text-red-950 flex justify-between items-center flex-wrap gap-2">
                    <span className="text-red-700 font-medium font-sans font-bold">هذه قيمة سرّية تم إدخالها كاسم متغير! ⚠️</span>
                    <span className="text-stone-800 bg-stone-100 px-2 py-0.5 rounded font-bold border border-stone-200 select-all">{item.key}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-red-800 mt-3 font-semibold leading-relaxed">
                💡 <strong>طريقة التصحيح لحل المشكلة نهائياً (مهم جداً):</strong>
                <br />اضغط على رمز الترس (⚙️ Settings) في المتصفح والذهاب لتبويب <strong>Secrets</strong>:
                <br />1. ابحث عن الأسطر التي تحمل هذه القيم الطويلة في حقل الاسم (Name).
                <br />2. احذف كل تلك المدخلات باستخدام أيقونة السلة (Delete 🗑️) المقابلة لكل منها للتخلص من التعارض والرموز القديمة.
                <br />3. أضف سطراً واحداً جديداً ونظيفاً بالكامل: ضع الاسم <code className="bg-white text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded font-mono select-all font-bold">MOONSHOT_API_KEY</code> في خانة الاسم (Name - العمود الأيسر) ثُم الصق مفتاح API الجديد (الذي يبدأ بـ sk-) في خانة القيمة (Value - العمود الأيمن).
              </p>
            </div>
          </div>
        )}

        {/* Diagnostics / Suggestions */}
        {testStatus === 'error' && testResult?.diagnostics && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-right space-y-3 mt-4">
            <div className="flex items-center gap-2 text-amber-800 font-bold">
              <XCircle className="w-5 h-5 text-amber-600 shrink-0" />
              <h4>تقرير فحص الرموز ومقترحات الحل:</h4>
            </div>
            <div className="text-sm text-amber-900 space-y-2 pr-2 leading-relaxed">
              <p>طول المفتاح المستلم من الإعدادات: <strong className="font-mono bg-amber-100 px-2 py-0.5 rounded">{testResult.diagnostics.length}</strong> حرفاً.</p>
              
              {testResult.diagnostics.suggestions && testResult.diagnostics.suggestions.length > 0 ? (
                <div className="space-y-1.5 mt-2">
                  <p className="font-semibold text-amber-950 font-bold">لوحظت الأخطاء المحتملة التالية عند القراءة:</p>
                  <ul className="space-y-1.5 text-amber-950 pr-2">
                    {testResult.diagnostics.suggestions.map((sug: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-amber-600 shrink-0 font-bold">←</span>
                        <span>{sug}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-amber-800 mt-1">
                  المفتاح مطابق شكلياً ومنسق بطريقة صحيحة (يبدأ بـ <code className="bg-amber-100 px-1 rounded font-mono">sk-</code> وطوله مناسب) ولكن تم رفضه تماماً من خوادم Kimi/Moonshot. يرجى مراجعة صلاحية المفتاح أو توليد مفتاح جديد بالكامل عبر منصة Moonshot AI واستبداله.
                </p>
              )}
              
              <div className="text-xs text-stone-600 border-t border-amber-200/60 pt-3 mt-3">
                🔹 <strong>تعليمات لحل المشكلة:</strong> اذهب لإعدادات Cloudflare Pages الخاصة بمشروعك ← Settings ← Environment variables، أضف متغيراً جديداً باسم <code className="bg-stone-100 text-stone-800 px-1 py-0.5 rounded font-mono select-all">MOONSHOT_API_KEY</code> وضع القيمة الصافية لمفتاحك (الذي يبدأ بـ sk-) مباشرة فيه بدون اسم المتغير وبدون أي علامات تنصيص، ثم احفظ الإعدادات وأعد نشر التطبيق ثم حاول من جديد.
              </div>
            </div>
          </div>
        )}

        {/* Detected Keys Table */}
        {testResult?.detectedKeys && (
          <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 mt-3 text-right">
            <h5 className="font-bold text-xs text-stone-700 mb-2.5">🔍 فحص متغيرات البيئة والمفاتيح النشطة في التطبيق:</h5>
            <div className="space-y-2 text-xs">
              {testResult.detectedKeys.map((k: any, idx: number) => (
                <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-xl border border-stone-200 bg-white">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-stone-900 bg-stone-100 px-1.5 py-0.5 rounded text-[11px] font-semibold">{k.name}</span>
                    {k.exists ? (
                      <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full font-bold">مليء (مكتشف)</span>
                    ) : (
                      <span className="text-[10px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-full">فارغ</span>
                    )}
                  </div>
                  {k.exists && (
                    <div className="flex items-center gap-3 justify-between sm:justify-start">
                      <span className="text-stone-500 text-[11px]">العرض الأول/الأخير: <strong className="font-mono text-stone-700 bg-stone-50 px-1.5 py-0.5 rounded border border-stone-100 select-all">{k.preview}</strong></span>
                      <span className="text-[10px] text-stone-400">({k.length} حرف)</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {testResult?.envScan && testResult.envScan.length > 0 && (
              <div className="mt-4 border-t border-stone-200 pt-3">
                <h6 className="font-bold text-[11px] text-stone-600 mb-2">📦 متغيرات إضافية ومخصصة تم اكتشافها:</h6>
                <div className="space-y-1.5">
                  {testResult.envScan.map((k: any, idx: number) => (
                    <div key={idx} className={cn(
                      "flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg border text-[11px]",
                      k.isSuspiciousSwapped 
                        ? "border-red-200 bg-red-50 text-red-900 font-bold" 
                        : "border-stone-100 bg-stone-50/50 text-stone-600"
                    )}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-stone-200/60 select-all max-w-[200px] truncate">{k.key}</span>
                        {k.isSuspiciousSwapped && (
                          <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-bold animate-pulse">⚠️ قيمة سريّة مقلوبة كاسم متغير!</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-right">
                        <span>محتوى المتغير: <strong className="font-mono select-all bg-white px-1 py-0.5 rounded border border-stone-100">{k.preview}</strong></span>
                        <span className="text-[10px] opacity-70">({k.length} حرف)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] text-stone-400 mt-2.5 leading-relaxed">
              * ملاحظة الخطوط: حرف "I" (آي الكبير) في مفاتيح Google يتشابه شكلياً مع حرف "l" (إل الصغير) في خط السيرف المعتاد للأجهزة الذكية (مثال: AIzaSy تظهر AlzaSy). هذا مجرد تشابه في الخط وليس خطأ إملائياً، ويتم نقله والتعامل معه برمجياً كحرف "I" الكبير بشكل سليم.
            </p>
          </div>
        )}
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
  const [questions, setQuestions] = useState<Question[]>(() => ensureTwoLevelHierarchy(initialData?.questions || []));
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

        const cleanAllQuestionsText = (qs: Question[], isTopLevel: boolean = true): Question[] => {
          return qs.map(q => ({
            ...q,
            text: cleanQuestionText(q.text, undefined, isTopLevel),
            subQuestions: q.subQuestions ? cleanAllQuestionsText(q.subQuestions, false) : []
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
      const examData = removeUndefinedFields({
        title,
        duration,
        study,
        round,
        totalGrade,
        requiredQuestionsCount: requiredQuestionsCount || questions.length,
        questions: processedQuestions,
        authorUid: user.uid,
        updatedAt: serverTimestamp()
      });

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto" data-html2canvas-ignore>
          <button 
            onClick={() => {
              setExtractionMode('single');
              extractionInputRef.current?.click();
            }}
            className="flex flex-col items-center gap-4 p-6 bg-stone-50 border-2 border-stone-100 rounded-3xl hover:border-emerald-350 hover:bg-white transition-all text-right group shadow-sm hover:shadow-md"
          >
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform border border-stone-100">
              <FileUp className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="font-bold text-stone-900 mb-1 leading-tight text-base">الخيار الأول: ورقة (سؤال وجواب)</p>
              <p className="text-[11px] text-stone-500 leading-relaxed">يرفع صورة واحدة لكل سؤال وتحته الجواب، سيتم الربط تلقائياً.</p>
            </div>
          </button>

          <button 
            onClick={() => setExtractionMode('manual')}
            className="flex flex-col items-center gap-4 p-6 bg-blue-50/50 border-2 border-blue-105 rounded-3xl hover:border-blue-300 hover:bg-white transition-all text-right group shadow-sm hover:shadow-md"
          >
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform border border-blue-100">
              <PlusCircle className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-blue-900 mb-1 leading-tight text-base">الخيار الثاني: إضافة يدوية</p>
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
              value={title ?? ''} 
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: الكيمياء"
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-500">الدراسة</label>
            <input 
              type="text" 
              value={study ?? ''} 
              onChange={(e) => setStudy(e.target.value)}
              placeholder="مثال: الإعدادية / العلمي"
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-500">الدور</label>
            <input 
              type="text" 
              value={round ?? ''} 
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
                  value={totalGrade ?? ''} 
                  onChange={(e) => setTotalGrade(Number(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-500">عدد الأسئلة المطلوب حلها</label>
                <input 
                  type="number" 
                  value={requiredQuestionsCount ?? ''} 
                  onChange={(e) => setRequiredQuestionsCount(e.target.value ? Number(e.target.value) : null)}
                  placeholder={`الافتراضي: ${questions.length || 0}`}
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-500">الوقت (مثلاً: ثلاث ساعات)</label>
                <input 
                  type="text" 
                  value={duration ?? ''} 
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
                    </div>
                  )}

                  <div className="mr-6 space-y-4">
                    {q.subQuestions?.map((sq, sqIdx) => (
                      <div key={sq.id} className="space-y-4">
                        <div className="flex justify-between">
                          <p className="font-medium leading-relaxed">
                            {q.subStyle === 'letters' ? `${ARABIC_BRANCH_LETTERS[sqIdx % ARABIC_BRANCH_LETTERS.length]}- ` : `${sqIdx + 1}- `}
                            {cleanQuestionText(sq.text)}
                          </p>
                          <span className="text-sm">({formatGrade(sq.grade)} درجة)</span>
                        </div>
                        {sq.questionImage && <img src={sq.questionImage} className="max-h-48 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
                        
                        {(sq.answer || sq.answerImage) && (
                          <div className="text-sm text-stone-500 border-r-2 border-stone-100 pr-3 mr-2 mb-4">
                            <span className="font-bold">الجواب: </span>
                            {sq.answer && <span>{sq.answer}</span>}
                            {sq.answerImage && <img src={sq.answerImage} className="mt-1 max-h-48 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
                          </div>
                        )}
                        
                        <div className="mr-6 space-y-4">
                          {sq.subQuestions?.map((ssq, ssqIdx) => (
                            <div key={ssq.id} className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <p className="leading-relaxed">{ssqIdx + 1}- {cleanQuestionText(ssq.text)}</p>
                                <span>({formatGrade(ssq.grade)} درجة)</span>
                              </div>
                              {(ssq.answer || ssq.answerImage) && (
                                <div className="text-xs text-stone-500 border-r-2 border-stone-100 pr-3 mr-2">
                                  <span className="font-bold">الجواب: </span>
                                  {ssq.answer && <span>{ssq.answer}</span>}
                                  {ssq.answerImage && <img src={ssq.answerImage} className="mt-1 max-h-32 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Full Exam Preview for PDF (Questions & Answers) */}
        <div className="fixed left-[-9999px] top-0 w-[210mm] pdf-export-container" ref={examFullPrintRef}>
          <div className="px-[20mm] py-[25mm] bg-white space-y-8 text-right" dir="rtl" style={{ boxSizing: 'border-box' }}>
            <h2 className="text-3xl font-bold text-center border-b-4 border-stone-900 pb-4">نموذج الأسئلة والأجوبة النموذجية</h2>
            <div className="grid grid-cols-2 gap-4 text-lg border-b pb-4">
              <p><span className="font-bold">المادة:</span> {title}</p>
              <p><span className="font-bold">الدراسة:</span> {study}</p>
              <p><span className="font-bold">الدور:</span> {round}</p>
              <p><span className="font-bold">السنة الدراسية:</span> {new Date().getFullYear()} - {new Date().getFullYear() + 1}</p>
              <p><span className="font-bold">الدرجة الكلية:</span> {totalGrade}</p>
              <p><span className="font-bold">الوقت:</span> {duration}</p>
            </div>

            <div className="space-y-12">
              {questions.map((q, idx) => (
                <div key={q.id} className="p-6 border-2 border-stone-200 rounded-2xl space-y-6">
                  <div className="flex justify-between items-center bg-stone-50 p-3 rounded-xl">
                    <h4 className="text-xl font-bold leading-relaxed">س{idx + 1}: {cleanQuestionText(q.text)}</h4>
                    <span className="bg-stone-900 text-white px-4 py-1 rounded-full text-sm">{formatGrade(q.grade)} درجة</span>
                  </div>
                  
                  {(q.answer || q.answerImage) && (
                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                      <p className="text-emerald-800 font-bold mb-2">الإجابة النموذجية:</p>
                      {q.answer && <p className="whitespace-pre-wrap">{q.answer}</p>}
                      {q.answerImage && <img src={q.answerImage} className="mt-4 max-h-64 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
                    </div>
                  )}

                  <div className="mr-6 space-y-6">
                    {q.subQuestions?.map((sq, sqIdx) => (
                      <div key={sq.id} className="space-y-6 border-r-2 border-stone-100 pr-4">
                        <div className="flex justify-between font-bold">
                          <p className="leading-relaxed">{q.subStyle === 'letters' ? `${ARABIC_BRANCH_LETTERS[sqIdx % ARABIC_BRANCH_LETTERS.length]}- ` : `${sqIdx + 1}- `} {cleanQuestionText(sq.text)}</p>
                          <span>{sq.grade} درجة</span>
                        </div>
                        {sq.answer && (
                          <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 text-sm">
                            <p className="font-bold text-stone-500 mb-1">الجواب:</p>
                            <p className="whitespace-pre-wrap">{sq.answer}</p>
                            {sq.answerImage && <img src={sq.answerImage} className="mt-2 max-h-48 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
                          </div>
                        )}
                        {sq.subQuestions && sq.subQuestions.length > 0 && (
                          <div className="mr-6 space-y-4">
                            {sq.subQuestions.map((ssq, ssqIdx) => (
                              <div key={ssq.id} className="space-y-2 border-r border-stone-100 pr-4">
                                <div className="flex justify-between font-bold text-sm">
                                  <p className="leading-relaxed">{ssqIdx + 1}- {cleanQuestionText(ssq.text)}</p>
                                  <span>{ssq.grade} درجة</span>
                                </div>
                                {ssq.answer && (
                                  <div className="bg-white p-2 rounded border border-stone-100 text-xs">
                                    <p className="font-bold text-stone-400 mb-1">الجواب:</p>
                                    <p className="whitespace-pre-wrap">{ssq.answer}</p>
                                    {ssq.answerImage && <img src={ssq.answerImage} className="mt-1 max-h-32 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {(extractionMode === 'manual' || questions.length > 0) && (
          <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-stone-100 pt-6" data-html2canvas-ignore>
              <h3 className="text-xl font-bold">الأسئلة</h3>
              {(extractionMode === 'manual' || !questions.some(q => q.answer)) && (
                <button 
                  onClick={addQuestion}
                  className="text-emerald-600 flex items-center gap-1 text-sm font-bold hover:underline"
                >
                  <Plus className="w-4 h-4" /> إضافة سؤال
                </button>
              )}
            </div>
            
            <div className="space-y-4">
              {questions.map((q, index) => (
              <div key={q.id} className="p-2 sm:p-6 bg-stone-50 rounded-2xl border border-stone-200 space-y-3 relative group">
                <button 
                  onClick={() => removeQuestion(q.id)}
                  className="absolute top-2 left-2 sm:top-4 sm:left-4 p-1.5 sm:p-2 text-red-500 sm:text-stone-300 hover:text-red-500 hover:bg-red-50 bg-white sm:bg-transparent shadow-sm sm:shadow-none border border-red-100 sm:border-none rounded-xl opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all z-10"
                  title="حذف هذا السؤال بالكامل"
                >
                  <Trash2 className="w-5 h-5 md:w-4 md:h-4" />
                </button>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 md:gap-4">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 bg-white rounded-lg flex items-center justify-center font-bold text-stone-400 border border-stone-200 shrink-0">{index + 1}</span>
                    {/* Status Indicators - more polished */}
                    <div className="flex items-center gap-2">
                       {(q.questionImage || q.answerImage) && (
                         <div className="flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full border border-emerald-200 text-[10px] font-bold shadow-sm">
                           <ImageIcon className="w-3 h-3" /> مرفق صور
                         </div>
                       )}
                       {(q.subQuestions?.length || 0) > 0 && (
                         <div className="flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full border border-blue-200 text-[10px] font-bold shadow-sm">
                           <Layers className="w-3 h-3" /> نظام {q.subStyle === 'letters' ? 'فروع' : 'نقاط'}
                         </div>
                       )}
                    </div>
                  </div>
                  <div className="hidden sm:block flex-1" />
                  <div className="flex items-center justify-between sm:justify-end gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-stone-400">الدرجة:</span>
                      <input 
                        type="number" 
                        value={q.grade ?? ''} 
                        onChange={(e) => updateQuestion(q.id, { grade: Number(e.target.value) })}
                        className="w-16 px-2 py-1 rounded-lg border border-stone-200 text-sm text-center"
                      />
                    </div>
                  </div>
                </div>
                <textarea 
                  value={q.text ?? ''} 
                  onChange={(e) => {
                    updateQuestion(q.id, { text: e.target.value });
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  onFocus={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  placeholder="نص السؤال الرئيسي..."
                  rows={1}
                  className="w-full bg-white px-4 py-2 rounded-xl border border-stone-200 outline-none focus:ring-2 focus:ring-emerald-500 overflow-hidden resize-none"
                />

                {/* Quick Add Menu */}
                <div className="space-y-2 py-1" data-html2canvas-ignore>
                  {(!q.subQuestions?.length && !q.questionImage && !q.answerImage) && (
                    <p className="text-[10px] font-bold text-stone-400 mb-1">بإمكانك إضافة صورة أو فروع أو نقاط إذا كان السؤال الرئيسي يحتوي على ذلك:</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {!q.subQuestions?.length && !q.questionImage && !q.answerImage && (
                      <button 
                        onClick={() => updateQuestion(q.id, { questionImage: '' })}
                        className="text-[10px] text-stone-500 hover:text-emerald-600 flex items-center gap-1 bg-white border border-stone-100 px-3 py-1.5 rounded-lg transition-all shadow-sm"
                      >
                        <ImageIcon className="w-3 h-3 text-emerald-500" /> إضافة صور للسؤال
                      </button>
                    )}
                  {(!q.subQuestions || q.subQuestions.length === 0) && (
                    <>
                      <button 
                        onClick={() => addSubQuestion(q.id, undefined, 'letters')}
                        className="text-[10px] text-stone-500 hover:text-emerald-600 flex items-center gap-1 bg-white border border-stone-100 px-3 py-1.5 rounded-lg transition-all"
                      >
                        <Layers className="w-3 h-3" /> إضافة فروع (أ، ب، ج)
                      </button>
                      <button 
                        onClick={() => addSubQuestion(q.id, undefined, 'numbers')}
                        className="text-[10px] text-stone-500 hover:text-emerald-600 flex items-center gap-1 bg-white border border-stone-100 px-3 py-1.5 rounded-lg transition-all"
                      >
                        <Plus className="w-3 h-3" /> إضافة نقاط (1، 2، 3)
                      </button>
                    </>
                  )}
                  {(q.subQuestions?.length || 0) > 0 && (
                    <div className="flex flex-wrap items-center gap-3 w-full border-b border-stone-100 pb-3">
                      <div className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-bold flex items-center gap-2 flex-1">
                        <Layers className="w-3.5 h-3.5" />
                        نظام المكونات مفعل: بإمكانك إضافة الصور والإجابات لكل {q.subStyle === 'letters' ? 'فرع' : 'نقطة'} بالأسفل.
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => addSubQuestion(q.id, undefined, q.subStyle || 'letters')}
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-all flex items-center gap-1.5 text-[10px] font-bold"
                          title={q.subStyle === 'letters' ? "إضافة فرع جديد" : "إضافة نقطة جديدة"}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          إضافة {q.subStyle === 'letters' ? 'فرع' : 'نقطة'} جديد
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

                {(!q.subQuestions || q.subQuestions.length === 0) && (q.questionImage !== undefined || q.answerImage !== undefined || q.questionImage || q.answerImage) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in duration-300">
                    <ImageUpload 
                      label="صورة السؤال" 
                      value={q.questionImage} 
                      onChange={(base64) => updateQuestion(q.id, { questionImage: base64 })}
                      onRemove={() => updateQuestion(q.id, { questionImage: undefined })}
                    />
                    <ImageUpload 
                      label="صورة الجواب" 
                      value={q.answerImage} 
                      onChange={(base64) => updateQuestion(q.id, { answerImage: base64 })}
                      onRemove={() => updateQuestion(q.id, { answerImage: undefined })}
                    />
                  </div>
                )}
                
                {/* Sub-questions Section */}
                {(q.subQuestions?.length || 0) > 0 && (
                <div className="mr-0 sm:mr-4 md:mr-8 space-y-2.5 border-r-2 border-emerald-100 pr-1.5 sm:pr-3 md:pr-4 animate-in slide-in-from-right duration-300">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-stone-400">
                        {q.subStyle === 'letters' ? 'الفروع والترك:' : 'النقاط/الفراغات والترك:'}
                      </span>
                      <div className="flex items-center bg-stone-100 rounded-lg p-0.5">
                        <button 
                          onClick={() => updateQuestion(q.id, { subStyle: 'numbers' })}
                          className={cn(
                            "px-2 py-0.5 text-[8px] rounded-md transition-all",
                            (q.subStyle === 'numbers' || !q.subStyle) ? "bg-white text-emerald-600 shadow-sm" : "text-stone-400"
                          )}
                        >
                          1, 2, 3
                        </button>
                        <button 
                          onClick={() => updateQuestion(q.id, { subStyle: 'letters' })}
                          className={cn(
                            "px-2 py-0.5 text-[8px] rounded-md transition-all",
                            q.subStyle === 'letters' ? "bg-white text-emerald-600 shadow-sm" : "text-stone-400"
                          )}
                        >
                          أ, ب, ج
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-stone-400">
                        {q.subStyle === 'letters' ? 'عدد الفروع المطلوب حلها:' : 'عدد النقاط المطلوب حلها:'}
                      </span>
                      <input 
                        type="number" 
                        value={q.requiredSubCount || ''} 
                        onChange={(e) => updateQuestion(q.id, { requiredSubCount: e.target.value ? Number(e.target.value) : undefined })}
                        placeholder={q.subQuestions?.length.toString()}
                        className="w-10 px-1 py-0.5 rounded border border-stone-200 text-[10px] text-center"
                      />
                    </div>
                  </div>
                  {q.subQuestions?.map((sq, sqIndex) => (
                    <div key={sq.id} className="p-1.5 sm:p-4 bg-blue-50/30 rounded-xl border border-blue-100 space-y-2.5 relative group/sub shadow-sm transition-all hover:bg-blue-50/50">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-blue-600 shrink-0">
                            {q.subStyle === 'letters' ? `(${ARABIC_BRANCH_LETTERS[sqIndex % ARABIC_BRANCH_LETTERS.length]})` : `${sqIndex + 1}-`}
                          </span>
                          <div className="flex items-center gap-1">
                            {(sq.questionImage || sq.answerImage) && (
                              <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-md border border-emerald-200 text-[8px] font-bold shadow-sm">
                                <ImageIcon className="w-2 h-2" /> مرفق صور
                              </div>
                            )}
                            {(sq.subQuestions?.length || 0) > 0 && (
                              <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-md border border-blue-200 text-[8px] font-bold shadow-sm">
                                <Layers className="w-2 h-2" /> يضم نقاط
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-1 gap-2">
                          <textarea 
                            value={sq.text ?? ''} 
                            onChange={(e) => {
                              updateQuestion(sq.id, { text: e.target.value }, q.id);
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            onFocus={(e) => {
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            placeholder="نص السؤال الفرعي..."
                            rows={1}
                            className="flex-1 bg-white px-3 py-1.5 rounded-lg border border-blue-200 text-sm outline-none focus:ring-2 focus:ring-blue-500 overflow-hidden resize-none placeholder:text-stone-400"
                          />
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
                          <button 
                            onClick={() => removeQuestion(sq.id, q.id)}
                            className="absolute -left-2 -top-2 sm:-left-10 md:-left-12 sm:top-1/2 sm:-translate-y-1/2 p-1.5 sm:p-2 text-red-500 sm:text-stone-300 hover:text-red-600 hover:bg-red-50 bg-white sm:bg-transparent shadow-sm sm:shadow-none border border-red-100 sm:border-none rounded-xl opacity-100 sm:opacity-0 group-hover/sub:opacity-100 transition-all z-10"
                            title={q.subStyle === 'letters' ? "حذف هذا الفرع" : "حذف هذه النقطة"}
                          >
                            <Trash2 className="w-4 h-4 sm:w-5 sm:h-5 md:w-4 md:h-4" />
                          </button>
                          <div className="flex flex-col gap-1">
                            {(!sq.subQuestions?.length && !sq.questionImage && q.subStyle === 'letters') && (
                              <p className="text-[9px] font-bold text-stone-400">بإمكانك إضافة صورة أو نقاط لهذا الفرع:</p>
                            )}
                            <div className="flex items-center gap-2">
                              <ImageUpload 
                                label="صورة" 
                                value={sq.questionImage} 
                                onChange={(base64) => updateQuestion(sq.id, { questionImage: base64 }, q.id)}
                                onRemove={() => updateQuestion(sq.id, { questionImage: undefined }, q.id)}
                                compact
                              />
                              {!sq.subQuestions?.length && q.subStyle === 'letters' && (
                                <button 
                                  onClick={() => addSubQuestion(q.id, sq.id, 'numbers')}
                                  className="text-[9px] text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-white border border-blue-100 px-2 py-1 rounded-md transition-all shadow-sm"
                                  title="بدء إضافة نقاط داخل هذا الفرع"
                                >
                                  <Plus className="w-2.5 h-2.5" /> إضافة نقاط
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-stone-400">الدرجة:</span>
                            <input 
                              type="number" 
                              value={sq.grade ?? ''} 
                              onChange={(e) => updateQuestion(sq.id, { grade: Number(e.target.value) }, q.id)}
                              className="w-12 px-1 py-0.5 rounded-md border border-stone-200 text-xs text-center"
                            />
                          </div>
                            
                        </div>
                      </div>

                      {/* Level 3: Points inside a Branch */}
                      <div className="mr-0 sm:mr-4 md:mr-6 space-y-2 border-r-2 border-blue-200 pr-1 sm:pr-3">
                        {sq.subQuestions && sq.subQuestions.length > 0 && (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                            <span className="text-[9px] font-bold text-blue-500">النقاط داخل هذا الفرع:</span>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] text-stone-400">المطلوب حلها:</span>
                                <input 
                                  type="number" 
                                  value={sq.requiredSubCount ?? ''} 
                                  onChange={(e) => updateQuestion(sq.id, { requiredSubCount: e.target.value ? Number(e.target.value) : undefined }, q.id)}
                                  placeholder={sq.subQuestions?.length.toString()}
                                  className="w-8 px-1 py-0.5 rounded border border-blue-200 text-[9px] text-center"
                                />
                              </div>
                              <button 
                                onClick={() => addSubQuestion(q.id, sq.id, 'numbers')}
                                className="text-[9px] text-emerald-600 hover:text-emerald-700 flex items-center gap-1 bg-white border border-emerald-100 px-2.5 py-1 rounded-md transition-all shadow-sm"
                              >
                                <Plus className="w-2.5 h-2.5" /> إضافة نقطة جديدة
                              </button>
                            </div>
                          </div>
                        )}
                        {sq.subQuestions?.map((ssq, ssqIndex) => (
                          <div key={ssq.id} className="relative group/point animate-in slide-in-from-right-2 duration-300">
                            <button 
                              onClick={() => removeQuestion(ssq.id, q.id, sq.id)}
                              className="absolute -left-2 -top-2 sm:-left-10 sm:top-1/2 sm:-translate-y-1/2 p-1.5 sm:p-2 text-red-500 sm:text-stone-300 hover:text-red-600 hover:bg-red-50 bg-white sm:bg-transparent shadow-md sm:shadow-none border border-red-100 sm:border-none rounded-lg opacity-100 sm:opacity-0 group-hover/point:opacity-100 transition-all z-10"
                              title="حذف هذه النقطة"
                            >
                              <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-3.5 md:h-3.5" />
                            </button>
                            <div className="flex flex-col gap-1.5 bg-emerald-50/20 p-1.5 sm:p-3 rounded-lg border border-emerald-100 shadow-sm transition-all hover:bg-emerald-50/40">
                              <div className="flex items-start gap-2">
                                <span className="text-[10px] font-bold text-emerald-600 mt-1 shrink-0">{ssqIndex + 1}-</span>
                                <div className="flex-1 space-y-2">
                                  <div className="flex items-center gap-1.5">
                                    <textarea 
                                      value={ssq.text ?? ''} 
                                      onChange={(e) => {
                                        updateQuestion(ssq.id, { text: e.target.value }, q.id, sq.id);
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                      }}
                                      onFocus={(e) => {
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                      }}
                                      placeholder="نص النقطة..."
                                      rows={1}
                                      className="flex-1 bg-white px-2 sm:px-3 py-1.5 rounded border border-emerald-200 text-[11px] outline-none resize-none overflow-hidden placeholder:text-stone-300 shadow-sm"
                                    />
                                    <div className="flex items-center gap-1 shrink-0">
                                      <ImageUpload 
                                        label="سؤال" 
                                        value={ssq.questionImage} 
                                        onChange={(base64) => updateQuestion(ssq.id, { questionImage: base64 }, q.id, sq.id)}
                                        onRemove={() => updateQuestion(ssq.id, { questionImage: undefined }, q.id, sq.id)}
                                        compact
                                      />
                                      <input 
                                        type="number" 
                                        value={ssq.grade ?? ''} 
                                        onChange={(e) => updateQuestion(ssq.id, { grade: Number(e.target.value) }, q.id, sq.id)}
                                        placeholder="درجة"
                                        className="w-10 px-1 py-0.5 rounded border border-emerald-200 text-[10px] text-center bg-white"
                                      />
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <div className="p-1 bg-emerald-100 rounded-md">
                                      <CheckSquare className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-emerald-700" />
                                    </div>
                                    <textarea 
                                      value={ssq.answer ?? ''} 
                                      onChange={(e) => {
                                        updateQuestion(ssq.id, { answer: e.target.value }, q.id, sq.id);
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                      }}
                                      onFocus={(e) => {
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                      }}
                                      placeholder="الجواب النموذجي للنقطة..."
                                      rows={1}
                                      className="flex-1 bg-white/80 px-2 sm:px-3 py-1.5 rounded border border-emerald-100 text-[10px] outline-none min-h-[32px] resize-none overflow-hidden shadow-sm"
                                    />
                                    <ImageUpload 
                                      label="جواب" 
                                      value={ssq.answerImage} 
                                      onChange={(base64) => updateQuestion(ssq.id, { answerImage: base64 }, q.id, sq.id)}
                                      onRemove={() => updateQuestion(ssq.id, { answerImage: undefined }, q.id, sq.id)}
                                      compact
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {(!sq.subQuestions || sq.subQuestions.length === 0) && (
                        <div className="space-y-2 animate-in fade-in duration-300">
                          <div className="flex items-center gap-1.5 px-0.5">
                            <CheckSquare className="w-3 h-3 text-emerald-600" />
                            <span className="text-[9px] font-bold text-stone-500 text-right">إجابة الفرع النموذجية:</span>
                          </div>
                          <textarea 
                            value={sq.answer ?? ''} 
                            onChange={(e) => {
                              updateQuestion(sq.id, { answer: e.target.value }, q.id);
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            onFocus={(e) => {
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            placeholder="أدخل الإجابة النموذجية لهذا الفرع..."
                            rows={1}
                            className="w-full bg-emerald-50/30 px-3 py-2 rounded-lg border border-emerald-100 text-xs outline-none focus:ring-2 focus:ring-emerald-500 overflow-hidden resize-none min-h-[40px]"
                          />
                          <div className="grid grid-cols-2 gap-4 mt-2">
                            <ImageUpload 
                              label="صورة الجواب للفرع" 
                              value={sq.answerImage} 
                              onChange={(base64) => updateQuestion(sq.id, { answerImage: base64 }, q.id)}
                              onRemove={() => updateQuestion(sq.id, { answerImage: undefined }, q.id)}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                )}

                {(!q.subQuestions || q.subQuestions.length === 0) && (
                  <div className="space-y-2 animate-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center gap-2 px-1">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-xs font-bold text-stone-500">الإجابة النموذجية للسؤال:</span>
                    </div>
                    <textarea 
                      value={q.answer ?? ''} 
                      onChange={(e) => {
                        updateQuestion(q.id, { answer: e.target.value });
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      onFocus={(e) => {
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      placeholder="اكتب الإجابة التي سيتم التصحيح بناءً عليها..."
                      rows={1}
                      className="w-full bg-emerald-50/50 px-4 py-3 rounded-xl border border-emerald-100 outline-none focus:ring-2 focus:ring-emerald-500 placeholder:text-stone-400 text-stone-700 min-h-[80px] text-sm"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function VisualPaperOverlay({ 
  imageUrl, 
  gradings, 
  allGradings, 
  pageIndex, 
  onGradingsChange, 
  studentName, 
  totalGrade, 
  maxGrade, 
  isFirstPage, 
  quickGradingActive = true, 
  activePen = 'correct' 
}: any) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [editingGrading, setEditingGrading] = useState<{ index: number, x: number, y: number } | null>(null);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setDimensions({ width: naturalWidth, height: naturalHeight });
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;

    // 1. Collision Check against existing Marks of this page index
    let clickedMarkIndex = -1;
    let minDistance = 60; // Max click distance tolerance (60 units in 1000x1000 coordinate space)

    gradings.forEach((g: any, i: number) => {
      if (!g.box) return;
      const [ymin, xmin, ymax, xmax] = g.box;
      const centerX = (xmin + xmax) / 2;
      const centerY = (ymin + ymax) / 2;
      const dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
      if (dist < minDistance) {
        minDistance = dist;
        clickedMarkIndex = i;
      }
    });

    if (clickedMarkIndex !== -1) {
      // Toggle correctness or select for editing
      const targetMark = gradings[clickedMarkIndex];
      const globalIdx = allGradings.indexOf(targetMark);
      if (globalIdx !== -1) {
        let updatedGradings = [...allGradings];
        const currentMark = updatedGradings[globalIdx];
        
        if (quickGradingActive) {
          // Toggle correctness: ✓ -> × (grade = 0), × -> ✓ (grade = maxGrade or 1)
          const maxG = currentMark.maxGrade || 1;
          const newGrade = currentMark.grade > 0 ? 0 : maxG;
          currentMark.grade = newGrade;
        }

        const [ymin, xmin, ymax, xmax] = targetMark.box;
        const centerX = (xmin + xmax) / 2;
        const centerY = (ymin + ymax) / 2;
        setEditingGrading({ index: globalIdx, x: centerX, y: centerY });
        
        onGradingsChange(updatedGradings);
      }
    } else {
      // Clicked on empty space: Add a new mark box [y-20, x-20, y+20, x+20]
      const box: [number, number, number, number] = [y - 20, x - 20, y + 20, x + 20];
      const defaultGrade = (quickGradingActive && activePen === 'incorrect') ? 0 : 1;

      const newGrading = {
        questionId: `manual_${Date.now()}`,
        studentAnswer: 'تأشير يدوي',
        grade: defaultGrade,
        maxGrade: 1,
        feedback: 'تمت الإضافة يدوياً',
        box,
        pageIndex: pageIndex
      };

      const updatedGradings = [...allGradings, newGrading];
      onGradingsChange(updatedGradings);

      // Immediately open editing for the newly placed mark so they can adjust the score
      setEditingGrading({ index: updatedGradings.length - 1, x: x, y: y });
    }
  };

  const finalMaxGrade = maxGrade || calculateRecursiveTotalGrade(Array.isArray(gradings) ? [] : []);
  
  return (
    <div className="relative w-full rounded-2xl overflow-hidden shadow-sm border border-stone-200 bg-stone-100">
      <div 
        ref={containerRef} 
        className="relative w-full cursor-crosshair"
        onClick={handleContainerClick}
      >
        <img 
          src={imageUrl} 
          alt="" 
          className="w-full h-auto block pointer-events-none" 
          onLoad={handleImageLoad}
          crossOrigin="anonymous"
        />
        {dimensions.width > 0 && (
          <svg 
            viewBox="0 0 1000 1000" 
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            {/* Marks for each grading */}
            {gradings.map((g: any, i: number) => {
              if (!g.box) return null;
              const [ymin, xmin, ymax, xmax] = g.box;
              const maxG = g.maxGrade || 1;
              const isCorrect = g.grade > 0;
              const isFull = maxG > 0 && g.grade >= maxG;
              const isPartialLow = maxG > 0 && isCorrect && g.grade < (maxG * 0.7);
              
              const markColor = isFull ? "#059669" : (isPartialLow ? "#f59e0b" : "#10b981");
              const finalColor = isCorrect ? markColor : "#dc2626";
              const globalIdx = allGradings.indexOf(g);

              return (
                <g key={i}>
                  {/* Highlight ring for active editing mark */}
                  {editingGrading && editingGrading.index === globalIdx && (
                    <rect
                      x={Math.min(xmin, xmax > 850 ? xmin - 80 : xmax - 10) - 15}
                      y={Math.min(ymin, (ymin + ymax)/2 - 30) - 15}
                      width={Math.abs(xmax - xmin) + 140}
                      height={Math.abs(ymax - ymin) + 70}
                      fill="none"
                      stroke="#059669"
                      strokeWidth="3.5"
                      strokeDasharray="6 4"
                      rx="12"
                    />
                  )}

                  {/* The Mark (Check or Cross) */}
                  <text 
                    x={xmax > 850 ? Math.max(xmin - 15, 50) : Math.min(xmax + 15, 950)} 
                    y={Math.min(Math.max((ymin + ymax) / 2, 50), 950)} 
                    fontSize="52" 
                    fill={finalColor}
                    className="font-bold select-none drop-shadow-md pb-1"
                    textAnchor={xmax > 850 ? "end" : "start"}
                    dominantBaseline="middle"
                  >
                    {isCorrect ? "✓" : "×"}
                  </text>
                  {/* The Grade for the question */}
                  <rect 
                    x={xmax > 850 ? Math.max(xmin - 75, 10) : Math.min(xmax + 75, 940)} 
                    y={Math.min(Math.max(ymin, 10), 950)} 
                    width="50" 
                    height="40" 
                    rx="8"
                    fill="white"
                    fillOpacity="0.95"
                    stroke={finalColor}
                    strokeWidth="2.5"
                    className="drop-shadow-sm"
                  />
                  <text 
                    x={xmax > 850 ? Math.max(xmin - 50, 35) : Math.min(xmax + 100, 965)} 
                    y={Math.min(Math.max(ymin + 26, 36), 976)} 
                    fontSize="22" 
                    fill={finalColor}
                    className="font-bold select-none"
                    textAnchor="middle"
                  >
                    {g.grade}
                  </text>
                </g>
              );
            })}

            {/* Student Final Grade Overlay (Top Right) */}
            {isFirstPage && (
              <g transform="translate(800, 50)">
                <circle cx="50" cy="50" r="45" fill="white" fillOpacity="0.9" stroke="#059669" strokeWidth="4" />
                <text x="50" y="45" fontSize="24" fill="#059669" fontWeight="bold" textAnchor="middle">الدرجة</text>
                <line x1="20" y1="52" x2="80" y2="52" stroke="#059669" strokeWidth="2" />
                <text x="50" y="78" fontSize="22" fill="#059669" fontWeight="bold" textAnchor="middle">{totalGrade} / {finalMaxGrade || '?'}</text>
                
                <text x="-150" y="40" fontSize="24" fill="#374151" fontWeight="bold" textAnchor="end" className="italic">{studentName}</text>
              </g>
            )}
          </svg>
        )}

        {/* Floating Tooltip to Edit Mark */}
        {editingGrading && editingGrading.index < allGradings.length && (
          <div 
            onClick={(e) => e.stopPropagation()} 
            className="absolute z-50 bg-white border border-stone-200 shadow-xl rounded-2xl p-4 w-72 text-right transition-all sm:text-sm text-xs"
            style={{
              left: `${Math.min(Math.max(editingGrading.x / 10 - 36, 5), 64)}%`,
              top: `${Math.min(Math.max(editingGrading.y / 10 + 4, 2), 85)}%`,
            }}
          >
            <div className="flex items-center justify-between border-b border-stone-150 pb-2 mb-3">
              <span className="text-stone-700 font-bold text-sm">تعديل العلامة</span>
              <button 
                onClick={() => setEditingGrading(null)} 
                className="text-stone-400 hover:text-stone-600 p-1 rounded-full hover:bg-stone-50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-stone-500 font-bold text-xs">الدرجة الحالية:</span>
                <div className="flex items-center gap-2" dir="ltr">
                  <button 
                    type="button"
                    onClick={() => {
                      const updated = [...allGradings];
                      const newVal = Math.max(0, (updated[editingGrading.index].grade || 0) - 0.5);
                      updated[editingGrading.index].grade = parseFloat(newVal.toFixed(1));
                      onGradingsChange(updated);
                    }}
                    className="w-8 h-8 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 flex items-center justify-center font-black text-stone-600 text-lg select-none"
                  >
                    -
                  </button>
                  <input 
                    type="number"
                    step="0.5"
                    min="0"
                    value={allGradings[editingGrading.index]?.grade ?? 0}
                    onChange={(e) => {
                      const updated = [...allGradings];
                      const val = parseFloat(parseFloat(e.target.value).toFixed(1)) || 0;
                      updated[editingGrading.index].grade = val;
                      onGradingsChange(updated);
                    }}
                    className="w-16 h-8 text-center border border-stone-200 rounded-lg font-black text-stone-800 focus:outline-none focus:border-emerald-500"
                  />
                  <button 
                    type="button"
                    onClick={() => {
                      const updated = [...allGradings];
                      const newVal = (updated[editingGrading.index].grade || 0) + 0.5;
                      updated[editingGrading.index].grade = parseFloat(newVal.toFixed(1));
                      onGradingsChange(updated);
                    }}
                    className="w-8 h-8 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 flex items-center justify-center font-black text-stone-600 text-lg select-none"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Preset point buttons */}
              <div className="grid grid-cols-4 gap-1.5 pt-1" dir="rtl">
                {[0, 0.5, 1, 1.5, 2].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      const updated = [...allGradings];
                      updated[editingGrading.index].grade = p;
                      onGradingsChange(updated);
                    }}
                    className={cn(
                      "py-1 rounded-lg text-xs font-bold transition-all border",
                      allGradings[editingGrading.index]?.grade === p
                        ? "bg-emerald-500 border-emerald-500 text-white shadow-sm"
                        : "bg-stone-50 border-stone-200 hover:bg-stone-100 text-stone-600"
                    )}
                  >
                    {p} د
                  </button>
                ))}
                
                {/* Toggle sign (✓ / ×) */}
                <button
                  type="button"
                  onClick={() => {
                    const updated = [...allGradings];
                    const currentItem = updated[editingGrading.index];
                    const isCorr = currentItem.grade > 0;
                    if (isCorr) {
                      currentItem.grade = 0;
                    } else {
                      currentItem.grade = currentItem.maxGrade || 1;
                    }
                    onGradingsChange(updated);
                  }}
                  className={cn(
                    "col-span-1 py-1 rounded-lg text-xs font-bold transition-all border flex items-center justify-center",
                    allGradings[editingGrading.index]?.grade > 0
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                      : "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
                  )}
                >
                  {allGradings[editingGrading.index]?.grade > 0 ? "صح ✓" : "خطأ ×"}
                </button>
              </div>

              {/* Actions (Delete and Done) */}
              <div className="flex gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => {
                    const updated = allGradings.filter((_: any, idx: number) => idx !== editingGrading.index);
                    onGradingsChange(updated);
                    setEditingGrading(null);
                  }}
                  className="flex-1 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition-colors flex items-center justify-center gap-1.5 font-bold text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  حذف
                </button>
                
                <button
                  type="button"
                  onClick={() => setEditingGrading(null)}
                  className="flex-[1.5] py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white transition-colors flex items-center justify-center font-bold text-xs"
                >
                  موافق
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Grader({ user, userProfile, exam, sessions, onComplete, onCancel }: any) {
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [gradingMode, setGradingMode] = useState<'digital' | 'paper'>('digital');
  const [isGrading, setIsGrading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: '' });
  const [quickGradingActive, setQuickGradingActive] = useState(true);
  const [activePen, setActivePen] = useState<'correct' | 'incorrect'>('correct');
  const [selectedSubject, setSelectedSubject] = useState<string>(exam.title || 'رياضيات');
  const [gradingResults, setGradingResults] = useState<any[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);
  const [targetSessionId, setTargetSessionId] = useState<string>('new');
  const [newSessionName, setNewSessionName] = useState<string>('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [activeLogs, setActiveLogs] = useState<string[]>([]);
  const consoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [activeLogs]);

  useEffect(() => {
    if (!isGrading) {
      setActiveLogs([]);
      return;
    }

    if (progress.phase === 'compressing') {
      setActiveLogs([
        "⏳ جاري تهيئة وبدء معالجة الصور...",
        `📸 تم استقبال عدد ${images.length} صفحة من إجابات الطالب.`,
        "🛠️ جاري تقليص صور الأوراق تلقائياً بشكل آمن لتسريع الرفع وحفظ النطاق الترددي..."
      ]);
    } else if (progress.phase === 'grading') {
      const allLogs = [
        "🌐 جاري تأسيس اتصال مشفر وآمن مع خوادم Kimi (Moonshot AI)...",
        "🔑 فحص واختيار مفتاح API ذكي تلقائياً... تم تفعيل المفتاح النشط الشغال بنجاح!",
        "🔬 جاري قراءة خط يد الطالب عبر الاستشعار والتعرف البصري (OCR)...",
        `📐 التعرف على مادة الامتحان: [${selectedSubject}] وضبط بيئة المعلم الذكي.`,
        "📝 جاري مطابقة إجابات الطالب مع نموذج الحل النموذجي لأسئلة الامتحان...",
        "⚖️ تفعيل خيار (التصحيح المرن): تقييم الفكر والخطوات الرياضية والتسامح في الهفوات الإملائية.",
        "✍️ جاري كتابة تعليقات تربوية باللغة العربية الفصحى تشجع الطالب وتشرح الهفوات.",
        "📊 حساب المجموع الكلي للدرجات تلقائياً واستثنائه من الأجزاء المتروكة لصالح الطالب..."
      ];

      setActiveLogs(prev => [
        ...prev,
        "✅ اكتمل ضغط الصور وتجهيزها بنجاح.",
        "🚀 بدء تفعيل المعلم الرقمي الذكي للبدء بالتصحيح الاسترشادي الفعلي..."
      ]);

      let index = 0;
      const interval = setInterval(() => {
        if (index < allLogs.length) {
          setActiveLogs(prev => [...prev, allLogs[index]]);
          index++;
        } else {
          clearInterval(interval);
        }
      }, 2000);

      return () => clearInterval(interval);
    }
  }, [isGrading, progress.phase, images.length, selectedSubject]);

  const examSessions = sessions.filter((s: any) => s.examId === exam.id);

  useEffect(() => {
    if (examSessions.length === 0) {
      setTargetSessionId('new');
      const date = new Date().toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' });
      setNewSessionName(`تصحيح - ${date}`);
    }
  }, [examSessions.length]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      if (images.length + newFiles.length > 24) {
        alert('عذراً، لا يمكن رفع أكثر من 24 صفحة في المرة الواحدة.');
        return;
      }
      setImages([...images, ...newFiles]);
      const newPreviews = newFiles.map(file => URL.createObjectURL(file));
      setPreviews([...previews, ...newPreviews]);
    }
  };

  const startGrading = async () => {
    if (images.length === 0) {
      alert('الرجاء رفع أو تصوير صور أوراق إجابات الطلاب أولاً قبل البدء بالتصحيح الذكي.');
      return;
    }
    
    // Check usage limit
    if (userProfile && (userProfile.pagesUsed + images.length) > userProfile.pageLimit) {
      return alert(`عذراً، لقد تجاوزت الحد المسموح به من الصفحات (${userProfile.pageLimit}). يرجى التواصل مع الإدارة لزيادة الحد.`);
    }

    setIsGrading(true);
    setProgress({ current: 0, total: images.length, phase: 'compressing' });
    try {
      const { results } = await gradeStudentPaper(
        previews, 
        exam.questions, 
        exam.totalGrade, 
        exam.requiredQuestionsCount,
        selectedSubject,
        (current, total, phase) => setProgress({ current, total, phase })
      );
      if (!results || results.length === 0) {
        throw new Error("لم يتم العثور على نتائج في الأوراق المرفوعة. تأكد من وضوح الصور وجودة الخط.");
      }

      // Update user usage stats atomically
      if (userProfile) {
        try {
          await setDoc(doc(db, 'users', user.uid), {
            pagesUsed: increment(images.length),
            gradingsCount: increment(results.length)
          }, { merge: true });
        } catch (e) {
          handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`);
        }
      }

      setGradingResults(results);
      setCurrentResultIndex(0);
    } catch (e: any) {
      console.error("Grading error:", e);
      alert(`عذراً، حدث خطأ أثناء التصحيح: ${e.message || 'خطأ غير معروف'}`);
    } finally {
      setIsGrading(false);
      setProgress({ current: 0, total: 0, phase: '' });
    }
  };

  const saveAllResults = async () => {
    if (targetSessionId === 'new' && !newSessionName.trim()) {
      alert('يرجى إدخال اسم للمجلد الجديد');
      return;
    }

    setIsSaving(true);
    try {
      // 1. Get or Create a session document
      let sessionId = targetSessionId;
      
      if (targetSessionId === 'new') {
        try {
          const sessionRef = await addDoc(collection(db, 'sessions'), {
            examId: exam.id,
            examTitle: exam.title,
            sessionName: newSessionName || exam.title,
            authorUid: user.uid,
            studentCount: gradingResults.length,
            createdAt: serverTimestamp()
          });
          sessionId = sessionRef.id;
        } catch (e) {
          handleFirestoreError(e, OperationType.CREATE, 'sessions');
        }
      } else {
        try {
          await updateDoc(doc(db, 'sessions', targetSessionId), {
            studentCount: increment(gradingResults.length)
          });
        } catch (e) {
          handleFirestoreError(e, OperationType.UPDATE, `sessions/${targetSessionId}`);
        }
      }

      // 2. Save each result with the sessionId
      for (const result of gradingResults) {
        try {
          // Recalculate total grade to ensure it's accurate from the final corrected marks
          const computedTotal = calculateGradingTotal(result.gradings);
          
          // Ensure studentName is not empty to satisfy security rules
          const studentName = (result.studentName && result.studentName.trim()) 
            ? result.studentName.trim() 
            : `طالب #${Math.floor(Math.random() * 1000)}`;

          await addDoc(collection(db, 'results'), removeUndefinedFields({
            studentName: studentName,
            gradings: result.gradings,
            totalGrade: computedTotal,
            sessionId: sessionId,
            examId: exam.id,
            examTitle: exam.title,
            authorUid: user.uid,
            createdAt: serverTimestamp()
          }));
        } catch (e) {
          handleFirestoreError(e, OperationType.CREATE, 'results');
        }
      }
      setShowSaveModal(false);
      onComplete();
    } catch (e: any) {
      console.error("Save error details:", e);
      let errorMsg = 'حدث خطأ أثناء حفظ النتائج';
      try {
        const errorData = JSON.parse(e.message);
        if (errorData.error.includes('permission')) {
          errorMsg = 'عذراً، لا تملك صلاحية الحفظ. يرجى التأكد من تسجيل الدخول والموافقة على حسابك.';
        } else {
          errorMsg = `خطأ: ${errorData.error}`;
        }
      } catch {
        errorMsg = `حدث خطأ: ${e.message}`;
      }
      alert(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  const currentGrading = gradingResults[currentResultIndex];
  const realTotalGrade = calculateGradingTotal(currentGrading?.gradings);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-4xl mx-auto space-y-8"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold font-serif italic">تصحيح الأوراق</h2>
          <p className="text-stone-500">امتحان: {exam.title}</p>
        </div>
        <button onClick={onCancel} className="text-stone-400 hover:text-stone-900 transition-colors">إلغاء</button>
      </div>

      {gradingResults.length === 0 ? (
        isGrading ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white p-6 sm:p-10 rounded-3xl border border-stone-200 shadow-sm space-y-8 text-right"
          >
            <div className="flex flex-col items-center text-center space-y-3 pb-6 border-b border-stone-100">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center relative">
                <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white animate-pulse" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-stone-900">جاري مراجعة وتصحيح الأوراق الآن</h3>
                <p className="text-sm text-stone-500 max-w-md mx-auto mt-1">
                  يقوم المعلم الإلكتروني بمطابقة إجابات الطالب بالنموذج المعتمد والتحقق المنهجي من الحلول والخطوات.
                </p>
              </div>
            </div>

            {/* Steps Timeline */}
            <div className="space-y-6 max-w-lg mx-auto">
              {/* Step 1 */}
              <div className="flex items-start gap-4">
                <div className="flex flex-col items-center select-none">
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center border text-[11px] font-black",
                    progress.phase === 'compressing'
                      ? "bg-emerald-50 border-emerald-500 text-emerald-600 animate-pulse"
                      : "bg-emerald-600 border-emerald-600 text-white"
                  )}>
                    {progress.phase === 'compressing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "١"}
                  </div>
                  <div className="w-0.5 h-10 bg-stone-200 mt-1" />
                </div>
                <div className="flex-[4] pt-0.5">
                  <h4 className="font-bold text-stone-800 text-sm">تهيئة الصور وضغطها التلقائي</h4>
                  <p className="text-xs text-stone-400 mt-0.5">
                    {progress.phase === 'compressing' 
                      ? `جاري تقليص الصور لضمان سرعة الرفع وحفظ النطاق... (${progress.current}/${progress.total})` 
                      : "تم تهيئة جميع أوراق الطالب وضغطها بنجاح 100%."}
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-start gap-4">
                <div className="flex flex-col items-center select-none">
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center border text-[11px] font-black",
                    progress.phase === 'compressing'
                      ? "bg-white border-stone-200 text-stone-300"
                      : "bg-emerald-50 border-emerald-500 text-emerald-600 animate-pulse"
                  )}>
                    {progress.phase === 'compressing' ? "٢" : "✓"}
                  </div>
                  <div className="w-0.5 h-10 bg-stone-200 mt-1" />
                </div>
                <div className="flex-[4] pt-0.5">
                  <h4 className="font-bold text-stone-800 text-sm">الاتصال الآمن والتحقق من مفاتيح Kimi</h4>
                  <p className="text-xs text-stone-400 mt-0.5">
                    {progress.phase === 'compressing' 
                      ? "بانتظار اكتمال معالجة أوراق الطالب..." 
                      : "تم فحص المفاتيح واجتياز المعطل والمباشرة بربط مشفر مع خوادم Moonshot المستقرة."}
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-start gap-4">
                <div className="flex flex-col items-center select-none">
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center border text-[11px] font-black",
                    progress.phase === 'compressing'
                      ? "bg-white border-stone-200 text-stone-300"
                      : "bg-emerald-50 border-emerald-500 text-emerald-600 animate-pulse"
                  )}>
                    {progress.phase === 'compressing' ? "٣" : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  </div>
                  <div className="w-0.5 h-10 bg-stone-200 mt-1" />
                </div>
                <div className="flex-[4] pt-0.5">
                  <h4 className="font-bold text-stone-800 text-sm">التعرف البصري وقراءة الإجابات المكتوبة بخط اليد</h4>
                  <p className="text-xs text-stone-400 mt-0.5">
                    {progress.phase === 'compressing' 
                      ? "بانتظار بدء كشط الإجابات..." 
                      : "الروبوت البصري يقوم بتحليل السطور والتعرف على الكلمات المكتوبة بقلم الحبر أو الرصاص..."}
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex items-start gap-4">
                <div className="flex flex-col items-center select-none">
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center border text-[11px] font-black",
                    progress.phase === 'compressing'
                      ? "bg-white border-stone-200 text-stone-300"
                      : "bg-emerald-50 border-emerald-500 text-emerald-600 animate-pulse"
                  )}>
                    {"٤"}
                  </div>
                  <div className="w-0.5 h-10 bg-stone-200 mt-1" />
                </div>
                <div className="flex-[4] pt-0.5">
                  <h4 className="font-bold text-stone-800 text-sm">التقييم ومطابقة الحلول بالنموذج</h4>
                  <p className="text-xs text-stone-400 mt-0.5">
                    {progress.phase === 'compressing' 
                      ? "بانتظار تطبيق سياسة الدرجات..." 
                      : `مقارنة الحل مادة [${selectedSubject}] مع تفعيل "التصحيح المنهجي المرن" لحساب تعويضات فروع الدرجة.`}
                  </p>
                </div>
              </div>

              {/* Step 5 */}
              <div className="flex items-start gap-4">
                <div className="flex flex-col items-center select-none">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center border border-stone-200 bg-white text-stone-300 text-[11px] font-black">
                    {"٥"}
                  </div>
                </div>
                <div className="flex-[4] pt-0.5">
                  <h4 className="font-bold text-stone-800 text-sm">الرصد الإحصائي النهائي وحذف فروع الترك</h4>
                  <p className="text-xs text-stone-400 mt-0.5">
                    احتساب درجات الفراغات، واستثناء أصغر فروع الأسئلة تلقائياً لصالح الطالب لتجهيز جدول العلامات.
                  </p>
                </div>
              </div>
            </div>

            {/* Live Console Terminal */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-stone-500 px-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-mono text-stone-600">Smart AI Engine Trace...</span>
                </div>
                <span>شاشة رصد حركة الذكاء الاصطناعي</span>
              </div>
              <div 
                ref={consoleRef}
                className="bg-stone-900 text-stone-100 font-mono text-[11px] rounded-2xl p-4 border border-stone-800 h-44 overflow-y-auto space-y-2.5 text-right w-full"
                dir="rtl"
              >
                {activeLogs.map((log, idx) => (
                  <div key={idx} className="flex gap-2 items-start text-emerald-400 leading-relaxed font-semibold">
                    <span className="text-stone-500 select-none">&gt;</span>
                    <span className="text-stone-100">{log}</span>
                  </div>
                ))}
                <div className="flex gap-2 items-center text-stone-500 text-[10px] italic">
                  <span>&gt; (Listening for live AI-Teacher events...)</span>
                  <span className="w-1.5 h-3.5 bg-emerald-500 animate-pulse inline-block" />
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <div 
            onClick={(e) => {
              if (previews.length === 0) {
                fileInputRef.current?.click();
              }
            }}
            className={cn(
              "bg-white p-6 sm:p-12 rounded-3xl border-2 transition-all text-center space-y-6",
              previews.length === 0 
                ? "border-dashed border-stone-200 hover:border-emerald-400 hover:bg-emerald-50/5 cursor-pointer" 
                : "border-solid border-stone-200"
            )}
          >
            {previews.length === 0 && (
              <>
                <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
                  <Upload className="w-10 h-10 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-xl font-bold mb-2">ارفع صور أوراق الطلاب</h3>
                  <p className="text-stone-400 max-w-sm mx-auto">يمكنك رفع عدة صور لنفس الطالب. سيتعرف النظام على اسم الطالب من الورقة الأولى. (اضغط هنا لرفع الصور)</p>
                </div>
              </>
            )}
            <input 
              type="file" 
              multiple 
              accept="image/*" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileChange}
            />
            <input 
              type="file" 
              accept="image/*" 
              capture="environment"
              className="hidden" 
              ref={cameraInputRef} 
              onChange={handleFileChange}
            />
            <div className="flex flex-wrap gap-4 justify-center" onClick={(e) => e.stopPropagation()}>
              {previews.map((url, i) => (
                <div key={i} className="relative w-24 h-32 rounded-lg overflow-hidden border border-stone-200 group">
                  <img src={url} alt="" className="w-full h-full object-cover" crossOrigin="anonymous" />
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviews(previews.filter((_, idx) => idx !== i));
                      setImages(images.filter((_, idx) => idx !== i));
                    }}
                    className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-col items-center gap-2 w-full" onClick={(e) => e.stopPropagation()}>
              <div className="w-full max-w-sm space-y-2 mb-4 text-right">
                <label className="text-sm font-bold text-stone-600 block">مادة الامتحان لتخصيص الذكاء الاصطناعي:</label>
                {user.email?.toLowerCase()?.trim() === 'asmaomar5566@gmail.com' ? (
                  <select 
                    value={selectedSubject ?? ''}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl border border-stone-200 bg-white focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-stone-700"
                  >
                    <option value="رياضيات">رياضيات (Math)</option>
                    <option value="أحياء">أحياء (Biology)</option>
                    <option value="كيمياء">كيمياء (Chemistry)</option>
                    <option value="فيزياء">فيزياء (Physics)</option>
                    <option value="قواعد">قواعد اللغة العربية</option>
                    <option value="إسلامية">تربية إسلامية</option>
                    <option value="إنجليزي font-bold">لغة إنجليزية</option>
                    <option value="عام">عام / مادة أخرى</option>
                  </select>
                ) : (
                  <input 
                    type="text"
                    value={selectedSubject ?? ''}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    placeholder="مثلاً: رياضيات، أحياء..."
                    className="w-full px-4 py-3 rounded-2xl border border-stone-200 bg-white focus:ring-2 focus:ring-emerald-500 outline-none text-right"
                  />
                )}
              </div>

              <p className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
                <HelpCircle className="w-3 h-3" />
                بإمكانك رفع حتى 24 صفحة في المرة الواحدة لضمان سرعة المعالجة
              </p>
              <div className="flex flex-col items-center gap-4 w-full" onClick={(e) => e.stopPropagation()}>
                <div className="flex bg-stone-100 p-1.5 rounded-2xl gap-2 w-full max-w-sm">
                  <button 
                    onClick={() => setGradingMode('digital')}
                    className={cn(
                      "flex-1 flex flex-col items-center py-3 rounded-xl transition-all gap-1",
                      gradingMode === 'digital' 
                        ? "bg-white text-emerald-700 shadow-sm" 
                        : "text-stone-400 hover:text-stone-600"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-4 h-4" />
                      <span className="font-bold text-sm">تقرير رقمي</span>
                    </div>
                    <span className="text-[10px] opacity-70">عرض النتائج كتقرير وجدول</span>
                  </button>
                  <button 
                    onClick={() => setGradingMode('paper')}
                    className={cn(
                      "flex-1 flex flex-col items-center py-3 rounded-xl transition-all gap-1",
                      gradingMode === 'paper' 
                        ? "bg-white text-emerald-700 shadow-sm" 
                        : "text-stone-400 hover:text-stone-600"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-4 h-4" />
                      <span className="font-bold text-sm">تصحيح ورقي</span>
                    </div>
                    <span className="text-[10px] opacity-70">وضع العلامات على صورة الورقة</span>
                  </button>
                </div>

                <div className="flex justify-center gap-4 w-full">
                  <button 
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    className="flex-1 px-4 sm:px-8 py-3 rounded-2xl border border-stone-200 font-medium hover:bg-stone-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    <span className="hidden sm:inline">اختيار الصور</span>
                    <span className="sm:hidden text-xs">ارفع صور</span>
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); cameraInputRef.current?.click(); }}
                    className="flex-1 px-4 sm:px-8 py-3 rounded-2xl border border-stone-200 font-medium hover:bg-stone-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <Camera className="w-4 h-4" />
                    <span className="hidden sm:inline">فتح الكاميرا</span>
                    <span className="sm:hidden text-xs">الكاميرا</span>
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); startGrading(); }}
                    disabled={isGrading}
                    className={cn(
                      "flex-[2] px-6 sm:px-8 py-3 rounded-2xl text-white font-medium transition-colors flex items-center justify-center gap-2",
                      images.length === 0 ? "bg-stone-400 hover:bg-stone-500 cursor-pointer" : "bg-emerald-600 hover:bg-emerald-700"
                    )}
                  >
                    {isGrading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                    {isGrading && progress.total > 0 
                      ? `${progress.phase === 'compressing' ? 'جاري ضغط الصور' : 'جاري التصحيح'} (${progress.current}/${progress.total})...` 
                      : (gradingMode === 'paper' ? 'بدء التصحيح الورقي' : 'بدء التصحيح الذكي')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      ) : (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
          id="current-grading-result"
        >
          <div className="bg-white p-4 sm:p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6 border-b border-stone-100 pb-8">
              <div className="text-center sm:text-right">
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-[0.2em] mb-1 block">
                  {gradingMode === 'digital' ? 'تقرير التصحيح الرقمي' : 'عرض التصحيح الورقي'}
                </span>
                <h3 className="text-2xl sm:text-3xl font-black text-stone-900 leading-tight">
                  {currentGrading.studentName}
                </h3>
                <div className="mt-2 flex items-center gap-2 text-stone-400 text-sm font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  تم رصد النتيجة النهائية بنجاح
                </div>
              </div>
              
              <div className="relative group">
                <div className="absolute -inset-4 bg-emerald-100 rounded-[2.5rem] opacity-30 blur-xl group-hover:opacity-50 transition-opacity" />
                <div className="relative bg-emerald-50/50 border-2 border-emerald-100/50 px-8 py-6 rounded-[2rem] flex flex-col items-center justify-center min-w-[200px]">
                  <span className="text-[11px] font-black text-emerald-800 uppercase tracking-widest mb-1 underline decoration-emerald-200 underline-offset-4">
                    الدرجة النهائية
                  </span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-5xl sm:text-6xl font-black text-emerald-600 tracking-tighter">
                      {formatGrade(realTotalGrade)}
                    </span>
                    <span className="text-xl sm:text-2xl font-bold text-emerald-300">/ {formatGrade(exam.totalGrade || calculateRecursiveTotalGrade(exam.questions))}</span>
                  </div>
                </div>
              </div>
            </div>

            {gradingMode === 'digital' ? (
              <div className="space-y-4">
                {exam.questions.map((q: any) => (
                  <GradingResultItem 
                    key={q.id} 
                    question={q} 
                    gradings={currentGrading.gradings} 
                    onGradeChange={(qId: string, newGrade: number) => {
                      const newGradings = currentGrading.gradings.map((g: any) => 
                        g.questionId === qId ? { ...g, grade: newGrade } : g
                      );
                      const newTotal = newGradings.reduce((acc: any, curr: any) => acc + curr.grade, 0);
                      const newResults = [...gradingResults];
                      newResults[currentResultIndex] = { ...currentGrading, gradings: newGradings, totalGrade: newTotal };
                      setGradingResults(newResults);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-8">
                {/* لوحة أدوات التصحيح السريع */}
                <div className="bg-stone-50 border border-stone-200/80 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                      <Settings className="w-5 h-5 animate-pulse" />
                    </div>
                    <div className="text-right">
                      <h4 className="font-bold text-stone-800 text-sm">لوحة تصحيح الأوراق السريعة</h4>
                      <p className="text-stone-400 text-[11px]">عند النقر على الورقة، سيتم رصد تفاعلك تلقائياً. اضغط على أي علامة لفتح قائمة تعديل درجتها يدوياً.</p>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* زر تمكين / تعطيل التصحيح السريع */}
                    <button
                      type="button"
                      onClick={() => setQuickGradingActive(!quickGradingActive)}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5",
                        quickGradingActive
                          ? "bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/10"
                          : "bg-white border-stone-200 hover:bg-stone-50 text-stone-500"
                      )}
                    >
                      <span className={cn("w-2 h-2 rounded-full lg:inline-block", quickGradingActive ? "bg-white animate-pulse" : "bg-stone-300")} />
                      {quickGradingActive ? "التصحيح السريع: نشط" : "التصحيح السريع: غير نشط"}
                    </button>

                    {/* زر قلم صح أو قلم خطأ عند تفعيل التصحيح السريع */}
                    {quickGradingActive && (
                      <div className="flex bg-white p-1 rounded-xl border border-stone-200 gap-1 shadow-sm">
                        <button
                          type="button"
                          onClick={() => setActivePen('correct')}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
                            activePen === 'correct'
                              ? "bg-emerald-50 text-emerald-700 font-extrabold border border-emerald-100"
                              : "text-stone-400 hover:text-stone-600 border border-transparent"
                          )}
                        >
                          <span className="font-sans">✓</span>
                          <span>قلم صح (١ د)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActivePen('incorrect')}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
                            activePen === 'incorrect'
                              ? "bg-rose-50 text-rose-700 font-extrabold border border-rose-100"
                              : "text-stone-400 hover:text-stone-600 border border-transparent"
                          )}
                        >
                          <span className="font-sans">×</span>
                          <span>قلم خطأ (٠ د)</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {Array.from(new Set(currentGrading.gradings.map((g: any) => g.pageIndex)))
                  .filter((idx): idx is number => idx !== undefined && idx !== null)
                  .sort((a, b) => a - b)
                  .map((pageIdx, i) => (
                    <div key={pageIdx} className="space-y-2">
                      <div className="flex items-center justify-between text-stone-400 text-xs px-2">
                        <span>الصفحة {i + 1}</span>
                        <span>رقم الصورة في المتصفح: {pageIdx + 1}</span>
                      </div>
                      <VisualPaperOverlay 
                        imageUrl={previews[pageIdx]}
                        gradings={currentGrading.gradings.filter((g: any) => g.pageIndex === pageIdx)}
                        allGradings={currentGrading.gradings}
                        pageIndex={pageIdx}
                        quickGradingActive={quickGradingActive}
                        activePen={activePen}
                        onGradingsChange={(newGradings: any[]) => {
                          const newTotal = calculateGradingTotal(newGradings);
                          const newResults = [...gradingResults];
                          newResults[currentResultIndex] = { ...currentGrading, gradings: newGradings, totalGrade: newTotal };
                          setGradingResults(newResults);
                        }}
                        studentName={currentGrading.studentName}
                        totalGrade={currentGrading.totalGrade}
                        maxGrade={exam.totalGrade}
                        isFirstPage={i === 0}
                      />
                    </div>
                  ))
                }
                {currentGrading.gradings.every((g: any) => g.pageIndex === undefined) && (
                  <div className="text-center p-12 bg-stone-50 rounded-2xl border-2 border-dashed border-stone-200 text-stone-400">
                    لم يتم تحديد مواقع الإجابات على الورقة لهذا الطالب. يرجى استخدام التقرير الرقمي.
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col md:flex-row justify-between items-center gap-6 pt-6 border-t border-stone-100">
              <div className="flex flex-wrap items-center justify-center gap-3 w-full md:w-auto">
                <div className="flex gap-2">
                  <button 
                    disabled={currentResultIndex === 0}
                    onClick={() => setCurrentResultIndex(currentResultIndex - 1)}
                    className="px-4 py-2 rounded-xl border border-stone-200 disabled:opacity-30 hover:bg-stone-50 transition-colors"
                  >
                    السابق
                  </button>
                  <button 
                    disabled={currentResultIndex === gradingResults.length - 1}
                    onClick={() => setCurrentResultIndex(currentResultIndex + 1)}
                    className="px-4 py-2 rounded-xl border border-stone-200 disabled:opacity-30 hover:bg-stone-50 transition-colors"
                  >
                    التالي
                  </button>
                </div>
                <span className="text-stone-400 text-sm font-medium bg-stone-50 px-3 py-1.5 rounded-lg">
                  طالب {currentResultIndex + 1} من {gradingResults.length}
                </span>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto mt-4 md:mt-0 pb-4 md:pb-0">
                <button 
                  onClick={async () => {
                    const element = document.getElementById(`current-grading-result`);
                    if (element) {
                      const isPaper = gradingMode === 'paper';
                      await generatePDFFromElement(
                        element, 
                        `${currentGrading.studentName}_${isPaper ? 'تصحيح_ورقي' : 'نتيجة'}.pdf`, 
                        { padding: isPaper ? '5mm' : '20mm', ignoreImages: !isPaper }
                      );
                    }
                  }}
                  className="flex-1 sm:flex-none px-4 py-3 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 flex items-center justify-center gap-2 transition-all font-bold"
                >
                  <Download className="w-4 h-4" />
                  {gradingMode === 'paper' ? 'تحميل الأوراق المصححة (PDF)' : 'تحميل النتيجة (PDF)'}
                </button>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setGradingResults([])} 
                    className="flex-1 px-4 py-3 rounded-xl text-stone-500 hover:bg-stone-100 transition-colors text-sm font-medium border border-transparent"
                  >
                    إلغاء
                  </button>
                  {gradingMode === 'paper' && (
                    <button 
                      onClick={async () => {
                        setIsSaving(true);
                        try {
                          alert('سيبدأ الآن تحميل أوراق جميع الطلاب... قد يستغرق هذا وقتاً طويلاً. يرجى الانتظار.');
                          for (let i = 0; i < gradingResults.length; i++) {
                            setCurrentResultIndex(i);
                            // Wait for render
                            await new Promise(r => setTimeout(r, 1500));
                            const element = document.getElementById(`current-grading-result`);
                            if (element) {
                              await generatePDFFromElement(
                                element, 
                                `طالب_${i+1}_${gradingResults[i].studentName}_تصحيح_ورقي.pdf`, 
                                { padding: '5mm', ignoreImages: false }
                              );
                            }
                          }
                        } finally {
                          setIsSaving(false);
                        }
                      }} 
                      className="flex-1 px-4 py-3 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold hover:bg-emerald-100 active:scale-95 transition-all text-center flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      تحميل الكل
                    </button>
                  )}
                  <button 
                    onClick={() => setShowSaveModal(true)} 
                    className="flex-[2] px-8 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 active:scale-95 transition-all text-center"
                  >
                    {gradingMode === 'paper' ? 'حفظ في المجلد' : 'حفظ جميع النتائج'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Save Modal */}
          <AnimatePresence>
            {showSaveModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => !isSaving && setShowSaveModal(false)}
                  className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
                />
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl overflow-hidden"
                >
                  <div className="p-8 space-y-6">
                    <div className="flex items-center gap-3 text-emerald-600">
                      <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center">
                        <Folder className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-stone-900">مراجعة وحفظ النتائج</h3>
                        <p className="text-stone-400 text-sm">سيتم حفظ {gradingResults.length} طالباً في المجلد</p>
                      </div>
                    </div>

                    {/* Simple summary of grades */}
                    <div className="bg-stone-50 rounded-2xl p-4 max-h-48 overflow-y-auto border border-stone-100 space-y-2">
                       {gradingResults.map((res: any, idx: number) => (
                         <div key={idx} className="flex items-center justify-between py-2 border-b border-stone-100 last:border-0 px-2">
                           <div className="flex items-center gap-2">
                             <span className="w-6 h-6 bg-stone-200 rounded-full text-[10px] flex items-center justify-center font-mono">{idx + 1}</span>
                             <span className="font-bold text-stone-700 text-sm truncate max-w-[200px]">{res.studentName || 'طالب غير معروف'}</span>
                           </div>
                           <div className="flex items-center gap-1">
                             <span className="text-stone-400 text-xs">الدرجة:</span>
                             <span className={`font-bold ${res.totalGrade >= (exam.totalGrade * 0.5) ? 'text-emerald-600' : 'text-red-500'}`}>
                               {res.totalGrade}
                             </span>
                             <span className="text-stone-300 text-[10px]">/ {exam.totalGrade}</span>
                           </div>
                         </div>
                       ))}
                    </div>

                    <div className="space-y-4">
                      {examSessions.length > 0 && (
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-stone-700 block mr-1">إضافة إلى مجلد موجود:</label>
                          <select 
                            value={targetSessionId ?? ''}
                            onChange={(e) => setTargetSessionId(e.target.value)}
                            className="w-full p-4 rounded-2xl border border-stone-200 bg-stone-50 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                          >
                            <option value="new">+ إنشاء مجلد جديد</option>
                            {examSessions.map((s: any) => (
                              <option key={s.id} value={s.id}>{s.sessionName || s.examTitle} ({s.studentCount} طلاب)</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {targetSessionId === 'new' && (
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-stone-700 block mr-1">اسم المجلد الجديد:</label>
                          <input 
                            type="text"
                            value={newSessionName ?? ''}
                            onChange={(e) => setNewSessionName(e.target.value)}
                            placeholder="مثلاً: تصحيح الشهر الأول"
                            className="w-full p-4 rounded-2xl border border-stone-200 bg-stone-50 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                            autoFocus
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button 
                        disabled={isSaving}
                        onClick={() => setShowSaveModal(false)}
                        className="flex-1 py-4 rounded-2xl font-bold text-stone-400 hover:bg-stone-50 transition-colors"
                      >
                        إلغاء
                      </button>
                      <button 
                        disabled={isSaving}
                        onClick={saveAllResults}
                        className="flex-[2] bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                        تأكيد الحفظ
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Hidden container for PDF capture of current result */}
          <div className="fixed top-[-9999px] left-0 w-[210mm] pdf-export-container">
            <div id="current-grading-result" className="bg-white p-10 space-y-8">
              <div className="flex items-center justify-between border-b border-stone-100 pb-6">
                <div>
                  <h3 className="text-3xl font-bold">الطالب: {currentGrading.studentName}</h3>
                  <p className="text-stone-500 mt-2 text-lg">الامتحان: {exam.title}</p>
                </div>
                <div className="text-right">
                  <span className="text-stone-400 text-sm">الدرجة النهائية</span>
                  <div className="text-5xl font-bold text-emerald-600">
                    {currentGrading.totalGrade}
                    <span className="text-xl text-stone-300"> / {exam.totalGrade}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                {exam.questions.map((q: any) => (
                  <GradingResultItem 
                    key={q.id} 
                    question={q} 
                    gradings={currentGrading.gradings} 
                  />
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}


function ResultsView({ results, sessions, exams, onBack }: any) {
  const [selectedResult, setSelectedResult] = useState<any>(null);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>('all');

  const [isExporting, setIsExporting] = useState(false);
  const [isExportingAll, setIsExportingAll] = useState(false);
  const resultPrintRef = useRef<HTMLDivElement>(null);
  const allResultsPrintRef = useRef<HTMLDivElement>(null);

  const exportPDF = async (result: any) => {
    console.log(`[ResultsView] Exporting PDF for student: ${result.studentName}`);
    setIsExporting(true);
    try {
      // 1. Priority: Use the visible ref if it's the same student
      if (selectedResult?.id === result.id && resultPrintRef.current) {
        console.log(`[ResultsView] Using visible resultPrintRef`);
        await generatePDFFromElement(resultPrintRef.current, `${result.studentName}_نتيجة.pdf`, { padding: '20mm', ignoreImages: true });
        return;
      }

      // 2. Fallback: Use the hidden list element
      const element = document.getElementById(`print-result-list-${result.id}`);
      if (element) {
        console.log(`[ResultsView] Using hidden list element`);
        await generatePDFFromElement(element, `${result.studentName}_نتيجة.pdf`, { padding: '20mm', ignoreImages: true });
      } else {
        console.warn(`[ResultsView] Element not found for result: ${result.id}`);
        alert('يرجى فتح تفاصيل الطالب أولاً لتحميل الملف');
      }
    } catch (error) {
      console.error(`[ResultsView] Error in exportPDF:`, error);
    } finally {
      setIsExporting(false);
    }
  };

  const exportAllPDF = async () => {
    if (!allResultsPrintRef.current) return;
    setIsExportingAll(true);
    try {
      await generatePDFFromElement(allResultsPrintRef.current, `all_results_${selectedSession.examTitle}.pdf`);
    } finally {
      setIsExportingAll(false);
    }
  };

  const years = Array.from(new Set(sessions.map((s: any) => s.createdAt?.toDate().getFullYear()))).sort((a: any, b: any) => b - a);
  const months = [
    { id: 1, name: 'يناير' }, { id: 2, name: 'فبراير' }, { id: 3, name: 'مارس' },
    { id: 4, name: 'أبريل' }, { id: 5, name: 'مايو' }, { id: 6, name: 'يونيو' },
    { id: 7, name: 'يوليو' }, { id: 8, name: 'أغسطس' }, { id: 9, name: 'سبتمبر' },
    { id: 10, name: 'أكتوبر' }, { id: 11, name: 'نوفمبر' }, { id: 12, name: 'ديسمبر' }
  ];

  const filteredSessions = sessions.filter((s: any) => {
    const date = s.createdAt?.toDate();
    if (!date) return true;
    const yearMatch = selectedYear === 'all' || date.getFullYear() === selectedYear;
    const monthMatch = selectedMonth === 'all' || (date.getMonth() + 1) === selectedMonth;
    return yearMatch && monthMatch;
  }).sort((a: any, b: any) => b.createdAt?.toDate() - a.createdAt?.toDate());

  const sessionResults = results.filter((r: any) => r.sessionId === selectedSession?.id);

  const copyResultsToClipboard = () => {
    const tableHeader = "اسم الطالب\tالدرجة\n";
    const tableData = sessionResults.map((r: any) => `${r.studentName || 'بدون اسم'}\t${r.totalGrade}`).join('\n');
    navigator.clipboard.writeText(tableHeader + tableData)
      .then(() => alert('تم نسخ القائمة (لصق في إكسل مباشرة)'))
      .catch((err) => console.error('Failed to copy: ', err));
  };

  const deleteSession = async (e: React.MouseEvent, session: any) => {
    e.stopPropagation();
    if (!confirm(`هل أنت متأكد من حذف المجلد "${session.sessionName || session.examTitle}"؟ سيتم حذف جميع نتائج الطلاب المرتبطة به.`)) return;

    try {
      // 1. Delete all results associated with this session
      const resultsQuery = query(collection(db, 'results'), where('sessionId', '==', session.id));
      const resultsSnapshot = await getDocs(resultsQuery);
      
      const batch = writeBatch(db);
      resultsSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      // 2. Delete the session itself
      batch.delete(doc(db, 'sessions', session.id));
      
      await batch.commit();
      alert('تم حذف المجلد وجميع نتائجه بنجاح.');
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('حدث خطأ أثناء حذف المجلد.');
    }
  };

  if (selectedResult) {
    const exam = exams.find((e: any) => e.id === selectedResult.examId);
    return (
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-8"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-2 md:px-0" data-html2canvas-ignore>
          <button onClick={() => setSelectedResult(null)} className="flex items-center gap-2 text-stone-500 hover:text-stone-900 transition-colors w-fit font-bold">
            <ArrowRight className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
            العودة لقائمة الطلاب
          </button>
          <button 
            onClick={() => exportPDF(selectedResult)}
            disabled={isExporting}
            className="w-full sm:w-auto bg-emerald-600 text-white px-6 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-sm"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            تحميل تقرير النتيجة (PDF)
          </button>
        </div>

        <div ref={resultPrintRef} id={`print-result-${selectedResult.id}`} className="bg-white p-4 md:p-8 border shadow-sm rounded-3xl space-y-8 pdf-export-container">
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-stone-100 pb-6 gap-6">
            <div className="text-right">
              <h3 className="text-xl md:text-2xl font-bold text-stone-900 break-words">{selectedResult.studentName || 'اسم غير معروف'}</h3>
              <p className="text-stone-500 mt-1 text-sm md:text-base">{selectedResult.examTitle || 'امتحان غير محدد'}</p>
              {selectedResult.createdAt && (
                <p className="text-stone-400 text-[10px] md:text-sm mt-1">التاريخ: {selectedResult.createdAt.toDate().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              )}
            </div>
            <div className="text-right md:text-left flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center bg-stone-50 md:bg-transparent p-4 md:p-0 rounded-2xl border border-stone-100 md:border-0">
              <span className="text-stone-400 text-xs font-bold md:text-sm">الدرجة النهائية</span>
              <div className="text-3xl md:text-5xl font-bold text-emerald-600">
                {selectedResult.totalGrade}
                <span className="text-lg md:text-xl text-stone-300"> / {exam?.totalGrade || '?'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {exam?.questions.map((q: any) => (
              <GradingResultItem 
                key={q.id} 
                question={q} 
                gradings={selectedResult.gradings} 
              />
            ))}
          </div>
        </div>
      </motion.div>
    );
  }

  if (selectedSession) {
    return (
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-8"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-2">
          <button onClick={() => setSelectedSession(null)} className="flex items-center gap-2 text-stone-500 hover:text-stone-900 transition-colors w-fit font-bold text-sm">
            <ArrowRight className="w-5 h-5" />
            العودة للقائمة الرئيسية
          </button>
          <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-4 rounded-2xl border border-stone-100 shadow-sm">
            <div className="text-right sm:ml-6 ml-0 mb-4 sm:mb-0">
              <h3 className="text-lg font-bold text-stone-900">{selectedSession.sessionName || selectedSession.examTitle}</h3>
              <p className="text-stone-400 text-xs">{selectedSession.createdAt?.toDate().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
            <button 
              onClick={exportAllPDF}
              disabled={isExportingAll}
              className="w-full sm:w-auto bg-emerald-600 text-white px-6 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-lg shadow-emerald-600/20 font-bold"
            >
              {isExportingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              تحميل كل النتائج (PDF)
            </button>
            <button 
              onClick={copyResultsToClipboard}
              className="w-full sm:w-auto bg-stone-100 text-stone-600 px-6 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-stone-200 transition-colors font-bold border border-stone-200"
            >
              <LayoutGrid className="w-4 h-4" />
              نسخ للجدول (EXCEL)
            </button>
          </div>
        </div>

        {/* Hidden area for printing all results */}
        <div className="fixed top-[-9999px] left-0 w-[210mm] pdf-export-container" ref={allResultsPrintRef}>
          {sessionResults.map((res: any) => (
            <div key={res.id} className="bg-white p-10 mb-10 border-b-2" style={{ pageBreakAfter: 'always' }}>
              <div className="flex items-center justify-between border-b border-stone-100 pb-6 mb-8">
                <div>
                  <h3 className="text-3xl font-bold">نتيجة الطالب: {res.studentName}</h3>
                  <p className="text-stone-500 mt-2 text-lg">الامتحان: {res.examTitle}</p>
                </div>
                <div className="text-right">
                  <span className="text-stone-400 text-sm">الدرجة النهائية</span>
                  <div className="text-5xl font-bold text-emerald-600">
                    {res.totalGrade}
                    <span className="text-xl text-stone-300"> / {exams.find((e: any) => e.id === res.examId)?.totalGrade || '?'}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                {exams.find((e: any) => e.id === res.examId)?.questions.map((q: any) => (
                  <GradingResultItem 
                    key={q.id} 
                    question={q} 
                    gradings={res.gradings} 
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Hidden area for individual printing from list */}
        <div className="fixed top-[-9999px] left-0 w-[210mm] pdf-export-container">
          {sessionResults.map((res: any) => (
            <div key={res.id} id={`print-result-list-${res.id}`} className="bg-white p-10">
               <div className="flex items-center justify-between border-b border-stone-100 pb-6 mb-8">
                <div>
                  <h3 className="text-3xl font-bold">نتيجة الطالب: {res.studentName}</h3>
                  <p className="text-stone-500 mt-2 text-lg">الامتحان: {res.examTitle}</p>
                </div>
                <div className="text-right">
                  <span className="text-stone-400 text-sm">الدرجة النهائية</span>
                  <div className="text-5xl font-bold text-emerald-600">
                    {res.totalGrade}
                    <span className="text-xl text-stone-300"> / {exams.find((e: any) => e.id === res.examId)?.totalGrade || '?'}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                {exams.find((e: any) => e.id === res.examId)?.questions.map((q: any) => (
                  <GradingResultItem 
                    key={q.id} 
                    question={q} 
                    gradings={res.gradings} 
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="md:hidden divide-y divide-stone-100">
            {sessionResults.length > 0 ? sessionResults.map((res: any) => (
              <div 
                key={res.id} 
                className="p-5 active:bg-stone-50 transition-colors space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="font-bold text-stone-900 break-all max-w-[200px]">{res.studentName || 'بدون اسم'}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">الدرجة النهائية:</span>
                      <span className="text-xs font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                        {res.totalGrade ?? 0}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={() => exportPDF(res)}
                    className="p-3 bg-stone-50 text-stone-400 rounded-xl hover:text-emerald-600 transition-colors"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                </div>
                <button 
                  onClick={() => setSelectedResult(res)}
                  className="w-full py-3.5 rounded-xl bg-stone-900 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md shadow-stone-900/10"
                >
                  عرض تفاصيل النتيجة
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
              </div>
            )) : (
              <div className="p-16 text-center space-y-4">
                <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto">
                  <FileText className="w-8 h-8 text-stone-300" />
                </div>
                <div>
                  <p className="text-stone-900 font-bold">لا توجد نتائج</p>
                  <p className="text-stone-400 text-sm">لم يتم العثور على نتائج مسجلة لهذه المجموعة.</p>
                </div>
              </div>
            )}
          </div>

          <table className="hidden md:table w-full text-right">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                <th className="px-6 py-4 font-bold text-stone-500 text-sm text-right">اسم الطالب</th>
                <th className="px-6 py-4 font-bold text-stone-500 text-sm text-right">الدرجة</th>
                <th className="px-6 py-4 font-bold text-stone-500 text-sm text-left">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sessionResults.map((res: any) => (
                <tr key={res.id} className="hover:bg-stone-50 transition-colors group">
                  <td className="px-6 py-5 font-bold text-stone-900">{res.studentName}</td>
                  <td className="px-6 py-5">
                    <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl font-black text-sm border border-emerald-100/50">
                      {res.totalGrade}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-left">
                    <div className="flex items-center justify-end gap-3">
                      <button 
                        onClick={() => setSelectedResult(res)}
                        className="px-5 py-2 rounded-xl bg-stone-900 text-white text-xs font-bold hover:bg-emerald-600 transition-all shadow-sm active:scale-95"
                      >
                        عرض التفاصيل
                      </button>
                      <button 
                        onClick={() => exportPDF(res)}
                        className="p-2.5 bg-stone-50 text-stone-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                        title="تحميل النتيجة PDF"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {sessionResults.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-10 text-center text-stone-400 italic">لا توجد نتائج في هذه المجموعة</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold font-serif italic">نتائج الطلاب</h2>
          <p className="text-sm md:text-base text-stone-500">مجموعات التصحيح المنظمة حسب التاريخ</p>
        </div>
        <button onClick={onBack} className="text-stone-400 hover:text-stone-900 transition-colors w-fit">العودة</button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-stone-400" />
          <select 
            value={selectedYear ?? 'all'} 
            onChange={(e) => setSelectedYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="bg-stone-50 px-4 py-2 rounded-xl border border-stone-200 outline-none text-sm"
          >
            <option value="all">كل السنوات</option>
            {years.map((y: any) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select 
            value={selectedMonth ?? 'all'} 
            onChange={(e) => setSelectedMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="bg-stone-50 px-4 py-2 rounded-xl border border-stone-200 outline-none text-sm"
          >
            <option value="all">كل الشهور</option>
            {months.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="mr-auto flex items-center gap-2 text-sm text-stone-400">
          <span>إجمالي المجموعات:</span>
          <span className="font-bold text-stone-900">{filteredSessions.length}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSessions.map((session: any) => (
          <div 
            key={session.id} 
            onClick={() => setSelectedSession(session)}
            className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm hover:shadow-md transition-all cursor-pointer group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-stone-100 rounded-2xl flex items-center justify-center text-stone-600 group-hover:bg-emerald-50 group-hover:text-emerald-600 transition-colors">
                <Folder className="w-6 h-6" />
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="text-[10px] font-bold text-stone-400 bg-stone-50 px-2 py-1 rounded-lg">
                  {session.createdAt?.toDate().toLocaleDateString('ar-EG', { month: 'short', year: 'numeric' })}
                </div>
                <button 
                  onClick={(e) => deleteSession(e, session)}
                  className="p-2 text-stone-300 hover:text-red-500 transition-colors"
                  title="حذف المجلد"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <h3 className="text-lg font-bold mb-2 group-hover:text-emerald-600 transition-colors">{session.sessionName || session.examTitle}</h3>
            <div className="flex items-center gap-4 text-xs text-stone-500">
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" /> 
                {session.studentCount === 1 ? 'طالب واحد' : 
                 session.studentCount === 2 ? 'طالبان' : 
                 session.studentCount <= 10 ? `${session.studentCount} طلاب` :
                 `${session.studentCount} طالب`}
              </span>
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {session.createdAt?.toDate().toLocaleDateString('ar-EG')}</span>
            </div>
            <div className="mt-6 pt-4 border-t border-stone-50 flex items-center justify-between text-xs font-bold text-emerald-600 transition-all group-hover:bg-emerald-50/50 rounded-xl px-2">
              <span className="flex items-center gap-2">عرض تفاصيل المجموعة</span>
              <ArrowRight className="w-4 h-4 rotate-180 transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        ))}
        {filteredSessions.length === 0 && (
          <div className="col-span-full py-20 text-center bg-white rounded-3xl border-2 border-dashed border-stone-200">
            <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-8 h-8 text-stone-300" />
            </div>
            <p className="text-stone-400">لا توجد مجموعات تصحيح مطابقة للبحث.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// -----------------------------------------------------------------
// COMPONENT: MathDirectGrader (Direct Mathematical Visual Grading)
// -----------------------------------------------------------------
function MathDirectGrader({ user, userProfile, onCancel }: { user: any; userProfile: any; onCancel: () => void }) {
  const [examSheets, setExamSheets] = useState<File[]>([]);
  const [examPreviews, setExamPreviews] = useState<string[]>([]);
  const [studentPapers, setStudentPapers] = useState<File[]>([]);
  const [studentPreviews, setStudentPreviews] = useState<string[]>([]);
  const [totalGrade, setTotalGrade] = useState<number>(100);
  
  const [isGrading, setIsGrading] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ current: number; total: number; phase: string }>({ current: 0, total: 0, phase: '' });
  const [activeLogs, setActiveLogs] = useState<string[]>([]);
  const consoleRef = useRef<HTMLDivElement>(null);

  const [results, setResults] = useState<any[]>([]);
  const [selectedStudentIdx, setSelectedStudentIdx] = useState<number>(0);
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);
  const [sessionName, setSessionName] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const examInputRef = useRef<HTMLInputElement>(null);
  const studentInputRef = useRef<HTMLInputElement>(null);

  // Auto scroll console logs
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [activeLogs]);

  // Set up progress logs
  useEffect(() => {
    if (!isGrading) return;

    if (progress.phase === 'compressing') {
      setActiveLogs([
        "⏳ جاري استقبال الصور ومعالجتها...",
        `📁 تم رصد عدد ${examSheets.length} صور لأوراق الأسئلة.`,
        `📁 تم رصد عدد ${studentPapers.length} صور لأجوبة الطلاب.`,
        "🛠️ جاري تقليص وضغط أحجام الصور لضمان سرعة الرفع وحفظ النطاق الترددي..."
      ]);
    } else if (progress.phase === 'grading') {
      const logs = [
        "🌐 جاري تهيئة الاتصال الذكي المشفر بالكامل مع خوادم Kimi (Moonshot AI)...",
        "📐 البدء في الفحص واستخراج المسائل الحسابية والمعادلات من ورقة الأسئلة...",
        "✍️ جاري حل المسائل ذاتياً وتوليد الحلول الرياضية والمخرجات النموذجية للدرجات...",
        "🔎 جاري فحص خط يد الطالب على الأوراق المرفوعة بطريقة التعرف البصري المباشر (Direct OCR)...",
        "🎯 مطابقة الإجابات المكتوبة بخط اليد مع الحلول الرياضية الفصحى التي جرى حسابها...",
        "⚖️ تقييم الفروقات وتطبيق القواعد الحسابية والدرجات بدقة متناهية...",
        "📝 صياغة ملخصات التقييم والملاحظات التربوية البليغة باللغة العربية الفصحى..."
      ];

      setActiveLogs(prev => [
        ...prev,
        "✅ تم ضغط الصور وتجهيزها للاستعلام البصري بنجاح.",
        "🚀 جاري استقطاب معلم الرياضيات والبدء بالتصحيح الاسترشادي المباشر..."
      ]);

      let idx = 0;
      const interval = setInterval(() => {
        if (idx < logs.length) {
          setActiveLogs(prev => [...prev, logs[idx]]);
          idx++;
        } else {
          clearInterval(interval);
        }
      }, 2400);

      return () => clearInterval(interval);
    }
  }, [isGrading, progress.phase]);

  // Default Session Name based on Arabic date format
  useEffect(() => {
    const d = new Date().toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
    setSessionName(`تصحيح رياضيات مباشر - ${d}`);
  }, []);

  const handleExamUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setExamSheets([...examSheets, ...files]);
      const prevs = files.map(f => URL.createObjectURL(f));
      setExamPreviews([...examPreviews, ...prevs]);
    }
  };

  const handleStudentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setStudentPapers([...studentPapers, ...files]);
      const prevs = files.map(f => URL.createObjectURL(f));
      setStudentPreviews([...studentPreviews, ...prevs]);
    }
  };

  const handleRemoveExamImg = (idx: number) => {
    const updatedSheets = [...examSheets];
    updatedSheets.splice(idx, 1);
    setExamSheets(updatedSheets);

    const updatedPrevs = [...examPreviews];
    URL.revokeObjectURL(updatedPrevs[idx]);
    updatedPrevs.splice(idx, 1);
    setExamPreviews(updatedPrevs);
  };

  const handleRemoveStudentImg = (idx: number) => {
    const updatedPapers = [...studentPapers];
    updatedPapers.splice(idx, 1);
    setStudentPapers(updatedPapers);

    const updatedPrevs = [...studentPreviews];
    URL.revokeObjectURL(updatedPrevs[idx]);
    updatedPrevs.splice(idx, 1);
    setStudentPreviews(updatedPrevs);
  };

  const triggerStartGrading = async () => {
    if (examPreviews.length === 0) {
      alert("يرجى رفع صورة ورقة الأسئلة للبدء");
      return;
    }
    if (studentPreviews.length === 0) {
      alert("يرجى رفع صور إجابات وأوراق الطلاب للبدء");
      return;
    }

    setIsGrading(true);
    setProgress({ current: 0, total: examPreviews.length + studentPreviews.length, phase: 'compressing' });
    
    try {
      const response = await gradeMathDirect(
        examPreviews,
        studentPreviews,
        totalGrade,
        (curr, tot, ph) => setProgress({ current: curr, total: tot, phase: ph })
      );

      if (!response.results || response.results.length === 0) {
        throw new Error("لم ترجع خوادم الجريدر نتائج أو لا توجد أسئلة مقروءة بوضوح في الصور.");
      }

      setResults(response.results);
      setSelectedStudentIdx(0);
      
      // Update page limit stats if user is approved
      if (userProfile) {
        try {
          await updateDoc(doc(db, 'users', user.uid), {
            pagesUsed: increment(examSheets.length + studentPapers.length),
            gradingsCount: increment(response.results.length)
          });
        } catch (dbErr) {
          console.error("Failed to update stats in Firestore:", dbErr);
        }
      }
    } catch (err: any) {
      console.error(err);
      alert(`عذراً، حدث خطأ أثناء التصحيح المباشر: ${err.message || err}`);
    } finally {
      setIsGrading(false);
    }
  };

  // Adjust specific student grade directly in client
  const handleScoreChange = (qIdx: number, val: number) => {
    const updated = [...results];
    const student = updated[selectedStudentIdx];
    const item = student.gradings[qIdx];
    item.grade = Number(val);
    
    // Recompute total grade
    student.totalGrade = student.gradings.reduce((sum: number, g: any) => sum + (g.grade || 0), 0);
    setResults(updated);
  };

  // Adjust specific student feedback directly in client
  const handleFeedbackChange = (qIdx: number, val: string) => {
    const updated = [...results];
    const student = updated[selectedStudentIdx];
    const item = student.gradings[qIdx];
    item.feedback = val;
    setResults(updated);
  };

  // Save math grading results to Firestore
  const handleSaveToFirestore = async () => {
    if (!sessionName.trim()) {
      alert("يرجى إدخال اسم مجلد الحفظ أولاً.");
      return;
    }

    setIsSaving(true);
    try {
      // Create session doc
      const sessionRef = await addDoc(collection(db, 'sessions'), {
        examId: 'math-direct',
        examTitle: 'تصحيح رياضيات مباشر (بدون نموذج)',
        sessionName: sessionName,
        authorUid: user.uid,
        studentCount: results.length,
        createdAt: serverTimestamp()
      });

      // Save student results
      for (const res of results) {
        await addDoc(collection(db, 'results'), removeUndefinedFields({
          studentName: res.studentName && res.studentName.trim() ? res.studentName.trim() : "طالب بدون اسم",
          gradings: res.gradings.map((g: any, qIdx: number) => ({
            questionId: g.questionId || `q_${qIdx + 1}`,
            questionLabel: g.questionLabel || `سؤال ${qIdx + 1}`,
            questionText: g.questionText || '',
            correctAnswer: g.correctAnswer || '',
            studentAnswer: g.studentAnswer || '',
            grade: g.grade || 0,
            maxGrade: g.maxGrade || 0,
            feedback: g.feedback || '',
            box: g.box || null,
            pageIndex: g.pageIndex || 0
          })),
          totalGrade: res.totalGrade,
          maxGrade: res.maxGrade || totalGrade,
          sessionId: sessionRef.id,
          examId: 'math-direct',
          examTitle: 'تصحيح رياضيات مباشر (بدون نموذج)',
          authorUid: user.uid,
          createdAt: serverTimestamp()
        }));
      }

      setShowSaveModal(false);
      alert("تم حفظ نتائج التصحيح المباشر بنجاح في أرشيف النتائج!");
      onCancel(); // Back to dashboard
    } catch (err: any) {
      console.error(err);
      alert(`خطأ أثناء الحفظ: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Print results
  const triggerPrintResults = () => {
    window.print();
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
      dir="rtl"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-stone-200">
        <div className="space-y-1 text-center md:text-right">
          <h2 className="text-2xl md:text-3xl font-bold font-serif italic text-sky-950 flex items-center gap-2 justify-center md:justify-start">
            <span>التصحيح المباشر والسريع لدفاتر الرياضيات 📐</span>
          </h2>
          <p className="text-sm text-stone-500">
            أداة فورية لحل وتصحيح الرياضيات دون الحاجة لإدخال نموذج إجابات يدوي. ارفع صورة الأسئلة مع أوراق الطلاب ودع الذكاء الاصطناعي يقوم بالمطابقة والدرجات بلمح البصر!
          </p>
        </div>
        <button 
          id="btn-cancel-grade-math"
          onClick={onCancel}
          className="bg-stone-100 hover:bg-stone-200 text-stone-700 px-6 py-2.5 rounded-xl font-bold transition-all shrink-0 w-full md:w-auto"
        >
          رجوع للرئيسية
        </button>
      </div>

      {results.length === 0 ? (
        <>
          {/* Main Upload Workflow */}
          {!isGrading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Question Sheets Upload */}
              <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                  <h3 className="font-bold text-lg text-stone-800 flex items-center gap-1.5">
                    <span className="w-2 h-5 bg-sky-600 rounded-full inline-block" />
                    1. صورة ورقة الأسئلة الرسمية
                  </h3>
                  <span className="text-xs text-sky-600 font-bold bg-sky-50 px-2.5 py-1 rounded-lg">إلزامي لحساب الحلول</span>
                </div>
                
                <div 
                  id="zone-upload-questions"
                  onClick={() => examInputRef.current?.click()}
                  className="border-2 border-dashed border-sky-200 rounded-2xl p-8 hover:border-sky-500 hover:bg-sky-50/20 transition-all text-center cursor-pointer space-y-3"
                >
                  <FileText className="w-10 h-10 text-sky-600 mx-auto" />
                  <div className="space-y-1">
                    <p className="font-bold text-stone-700">اضغط لرفع ورقة الأسئلة</p>
                    <p className="text-xs text-stone-400">يدعم رفع ملفات الصور بصيغة JPG أو PNG</p>
                  </div>
                  <input 
                    type="file" 
                    ref={examInputRef} 
                    onChange={handleExamUpload} 
                    multiple 
                    className="hidden" 
                    accept="image/*"
                  />
                </div>

                {examPreviews.length > 0 && (
                  <div className="grid grid-cols-3 gap-3 pt-3">
                    {examPreviews.map((p, idx) => (
                      <div key={idx} className="relative group rounded-xl border border-stone-200 overflow-hidden bg-stone-50 h-24">
                        <img src={p} alt="" className="w-full h-full object-cover" />
                        <button 
                          onClick={() => handleRemoveExamImg(idx)}
                          className="absolute top-1 right-1 p-1 bg-red-650 hover:bg-red-700 text-white rounded-full transition-colors bg-red-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        <span className="absolute bottom-1 left-1 bg-stone-900/70 text-white text-[9px] px-1.5 py-0.5 rounded">صفحة {idx+1}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Student Papers Upload */}
              <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                  <h3 className="font-bold text-lg text-stone-800 flex items-center gap-1.5">
                    <span className="w-2 h-5 bg-emerald-600 rounded-full inline-block" />
                    2. أوراق إجابات الطلاب (بخط اليد)
                  </h3>
                  <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg">صور لأعمال ودفاتر الطلاب</span>
                </div>
                
                <div 
                  id="zone-upload-student-papers"
                  onClick={() => studentInputRef.current?.click()}
                  className="border-2 border-dashed border-emerald-200 rounded-2xl p-8 hover:border-emerald-500 hover:bg-emerald-50/20 transition-all text-center cursor-pointer space-y-3"
                >
                  <FileUp className="w-10 h-10 text-emerald-600 mx-auto" />
                  <div className="space-y-1">
                    <p className="font-bold text-stone-700">اضغط لرفع أوراق دفاتر الطلاب</p>
                    <p className="text-xs text-stone-400">يمكنك رفع عدة دفاتر في وقت واحد لمجموعة الطلاب</p>
                  </div>
                  <input 
                    type="file" 
                    ref={studentInputRef} 
                    onChange={handleStudentUpload} 
                    multiple 
                    className="hidden" 
                    accept="image/*"
                  />
                </div>

                {studentPreviews.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 pt-3">
                    {studentPreviews.map((p, idx) => (
                      <div key={idx} className="relative group rounded-xl border border-stone-200 overflow-hidden bg-stone-50 h-20">
                        <img src={p} alt="" className="w-full h-full object-cover" />
                        <button 
                          onClick={() => handleRemoveStudentImg(idx)}
                          className="absolute top-1 right-1 p-1 bg-red-650 hover:bg-red-700 text-white rounded-full transition-colors bg-red-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <span className="absolute bottom-1 left-1 bg-stone-900/70 text-white text-[8px] px-1 rounded">ورقة {idx+1}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Total Grade & Go button */}
              <div className="col-span-full bg-stone-50 p-6 rounded-3xl border border-stone-200 flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="flex flex-col gap-2 w-full sm:w-auto">
                  <label className="font-bold text-sm text-stone-700">الدرجة الكلية للامتحان الحسابي:</label>
                  <div className="flex items-center gap-3">
                    <input 
                      type="number" 
                      value={totalGrade} 
                      onChange={(e) => setTotalGrade(Math.max(1, Number(e.target.value)))}
                      className="bg-white border border-stone-300 w-28 px-4 py-2 rounded-xl text-center font-bold text-stone-800"
                    />
                    <span className="text-stone-400 text-xs">درجة (موزعة بالتناسب على كافة المسائل المكتشفة)</span>
                  </div>
                </div>

                <button
                  id="btn-trigger-grading-math"
                  onClick={triggerStartGrading}
                  className="bg-sky-600 text-white px-8 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-sky-700 transition-colors shadow-lg shadow-sky-600/30 w-full sm:w-auto shrink-0"
                >
                  <CheckSquare className="w-5 h-5 text-sky-200" />
                  بدء التصحيح الرياضي الذكي والفوري ⚡
                </button>
              </div>

            </div>
          ) : (
            /* Live Progress Visuals & Log Console */
            <div className="bg-stone-900 text-white p-8 rounded-3xl border border-stone-850 shadow-2xl space-y-6 max-w-3xl mx-auto text-right">
              <div className="flex flex-col items-center text-center space-y-4">
                <Loader2 className="w-12 h-12 text-sky-500 animate-spin" />
                <div className="space-y-1">
                  <h3 className="font-bold text-xl">جاري استدعاء المصحح الآلي...</h3>
                  <p className="text-xs text-stone-400">يقوم الذكاء الاصطناعي الآن بقراءة المسائل وحلها وتطبيق التصحيح المباشر على الأوراق</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold text-stone-400">
                  <span>جاري المعالجة...</span>
                  <span className="font-mono">{Math.round((progress.current / (progress.total || 1)) * 100)}%</span>
                </div>
                <div className="w-full bg-stone-800 h-2.5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-sky-500 transition-all duration-300"
                    style={{ width: `${(progress.current / (progress.total || 1)) * 100}%` }}
                  />
                </div>
              </div>

              {/* Premium Console Log Panel */}
              <div className="space-y-2">
                <span className="text-xs text-stone-500 uppercase tracking-wider font-bold">شاشة تتبع العمليات البصرية:</span>
                <div 
                  ref={consoleRef}
                  className="bg-black/60 border border-stone-800 p-4 rounded-xl font-mono text-[11px] text-emerald-400 h-48 overflow-y-auto space-y-1.5 text-right font-sans"
                >
                  {activeLogs.map((log, lIdx) => (
                    <div key={lIdx} className="fade-in">
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Results View dashboard */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* List of graded students (Left Panel) */}
          <div className="lg:col-span-4 bg-white p-6 rounded-3xl border border-stone-200 h-fit space-y-4">
            <h3 className="font-bold text-stone-700 text-sm border-b border-stone-100 pb-2.5">الطلاب المصححين:</h3>
            <div className="space-y-2">
              {results.map((r, rIdx) => {
                const percentage = Math.round((r.totalGrade / (r.maxGrade || totalGrade)) * 100);
                return (
                  <button 
                    key={rIdx}
                    onClick={() => setSelectedStudentIdx(rIdx)}
                    className={cn(
                      "w-full text-right p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 font-sans",
                      selectedStudentIdx === rIdx 
                        ? "border-sky-500 bg-sky-50/50 text-sky-900 font-bold shadow-sm" 
                        : "border-stone-200 hover:bg-stone-50 text-stone-750"
                    )}
                  >
                    <div className="flex flex-col text-right">
                      <span className="text-sm">{r.studentName || `طالب #${rIdx + 1}`}</span>
                      <span className="text-[10px] text-stone-400 font-bold font-mono">
                        نسبة النجاح: {percentage}%
                      </span>
                    </div>
                    <div className={cn(
                      "text-sm font-black px-3 py-1.5 rounded-xl font-mono",
                      percentage >= 50 ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                    )}>
                      {r.totalGrade} / {r.maxGrade || totalGrade}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="pt-4 border-t border-stone-100 space-y-3">
              <button 
                onClick={() => setShowSaveModal(true)}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-md shadow-emerald-600/10"
              >
                <Save className="w-5 h-5 text-emerald-200" />
                حفظ النتائج للأرشيف
              </button>
              <button 
                onClick={triggerPrintResults}
                className="w-full bg-stone-900 hover:bg-stone-800 text-white py-3 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-sm"
              >
                <Printer className="w-5 h-5 text-stone-400" />
                طباعة تقارير الطلاب
              </button>
              <button 
                onClick={() => {
                  if (confirm("هل تعيد عملية التصحيح وتلغي هذه الأوراق؟")) {
                    setResults([]);
                  }
                }}
                className="w-full bg-stone-100 hover:bg-red-50 hover:text-red-600 text-stone-600 py-3 rounded-2xl text-xs font-semibold"
              >
                إلغاء وإعادة التصحيح
              </button>
            </div>
          </div>

          {/* Graded solutions details (Right Panel) */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm space-y-6">
              
              {/* Student Header */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-stone-100 pb-4">
                <div>
                  <h4 className="text-xl font-bold text-stone-850">
                    تقرير درجات الطالب: <span className="text-sky-600">{results[selectedStudentIdx]?.studentName || "أعمال الطالب"}</span>
                  </h4>
                  <p className="text-xs text-stone-400 mt-1">كافة التفاصيل مستخرجة ذاتياً ومطابقة بذكاء اصطناعي فائق الدقة</p>
                </div>

                <div className="flex items-center gap-3 bg-stone-50 px-4 py-2.5 rounded-2xl border border-stone-200 font-mono">
                  <div className="text-right">
                    <span className="text-[9px] text-stone-400 uppercase font-bold block">مجموع الدرجة:</span>
                    <span className="text-lg font-black text-stone-800">
                      {results[selectedStudentIdx]?.totalGrade} / {results[selectedStudentIdx]?.maxGrade || totalGrade}
                    </span>
                  </div>
                </div>
              </div>

              {/* Questions List */}
              <div className="space-y-6">
                {results[selectedStudentIdx]?.gradings.map((g: any, qIdx: number) => {
                  const isCorrect = g.grade > 0;
                  return (
                    <div 
                      key={qIdx}
                      className={cn(
                        "p-5 rounded-2xl border transition-all space-y-4 text-right shadow-sm",
                        isCorrect 
                          ? "border-emerald-200 bg-emerald-50/10" 
                          : "border-red-200 bg-red-50/10"
                      )}
                    >
                      {/* Question Label & Grade score */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-stone-150 pb-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle className={cn("w-5 h-5", isCorrect ? "text-emerald-600" : "text-red-500")} />
                          <span className="font-bold text-[15px] text-stone-900">
                            {g.questionLabel || `سؤال ${qIdx + 1}`}
                          </span>
                        </div>
                        
                        {/* Interactive Marks custom adjustments */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-stone-400 font-bold">الدرجة:</span>
                          <input 
                            type="number" 
                            value={g.grade}
                            onChange={(e) => handleScoreChange(qIdx, Math.min(g.maxGrade || 20, Math.max(0, Number(e.target.value))))}
                            className="bg-white border border-stone-200 rounded-lg w-16 p-1 text-center font-bold text-stone-800"
                            max={g.maxGrade}
                            min={0}
                          />
                          <span className="text-stone-400 text-xs">/ {g.maxGrade || 25}</span>
                        </div>
                      </div>

                      {/* Mathematical formula of the question */}
                      {g.questionText && (
                        <div className="p-3 bg-white/70 border border-stone-100 rounded-xl">
                          <span className="text-[10px] text-stone-400 block font-bold">صيغة المسألة الحسابية المستخرجة:</span>
                          <span className="font-mono text-sm inline-block text-stone-700 font-bold" dir="ltr">
                            {g.questionText}
                          </span>
                        </div>
                      )}

                      {/* Solution vs. student answer side by side */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-3 bg-sky-50 rounded-xl border border-sky-100 text-right">
                          <span className="text-[9px] text-sky-800 block font-bold">النظام الذكي (الناتج ومسار الحل):</span>
                          <span className="font-mono text-sm text-sky-950 font-bold inline-block" dir="ltr">
                            {g.correctAnswer}
                          </span>
                        </div>

                        <div className="p-3 bg-stone-50 rounded-xl border border-stone-150 text-right">
                          <span className="text-[9px] text-stone-400 block font-bold">خط الطالب المكتشف بالحبر:</span>
                          <span className="font-mono text-sm text-stone-800 font-black inline-block" dir="ltr">
                            {g.studentAnswer || "لم يحل / فارغ"}
                          </span>
                        </div>
                      </div>

                      {/* Editable Feedback */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] text-stone-400 font-bold block">ملاحظات المعلم وتقييم السؤال:</span>
                        <input 
                          type="text" 
                          value={g.feedback}
                          onChange={(e) => handleFeedbackChange(qIdx, e.target.value)}
                          className="bg-white border border-stone-200 rounded-xl p-2.5 w-full text-xs text-stone-800 outline-none focus:border-sky-500 transition-colors"
                          placeholder="مثال: إجابة نموذجية، أحسنت!"
                        />
                      </div>

                    </div>
                  );
                })}
              </div>

            </div>
          </div>

        </div>
      )}

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-stone-200 shadow-2xl space-y-4 text-right">
            <h4 className="text-lg font-bold text-stone-900 border-b border-stone-100 pb-2.5">
              💾 حفظ المجلد الحالي إلى التقارير
            </h4>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-400">اسم مجلد التقرير:</label>
                <input 
                  type="text" 
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  className="bg-stone-50 border border-stone-200 p-3 rounded-xl w-full text-sm text-stone-750 font-medium outline-none focus:border-emerald-500"
                  placeholder="مثال: تصحيح الرياضيات الفصلي"
                />
              </div>

              <div className="bg-stone-50 p-3 rounded-xl border border-stone-100 space-y-1 text-xs text-stone-500 leading-relaxed">
                <p>💡 يحفظ هذا المجلد كافة دفاتر الطلاب والدرجات المستحقة مع الحلول الذكية!</p>
                <p>ستظهر النتائج تلقائياً في خانة <strong>النتائج (الأرشيف)</strong> في الشاشة الرئيسية فور الانتهاء.</p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button 
                  id="btn-confirm-save-math"
                  onClick={handleSaveToFirestore}
                  disabled={isSaving}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-sm text-sm"
                >
                  {isSaving ? "جاري الحفظ..." : "تأكيد الحفظ"}
                </button>
                <button 
                  id="btn-cancel-save-math"
                  onClick={() => setShowSaveModal(false)}
                  disabled={isSaving}
                  className="flex-1 bg-stone-150 hover:bg-stone-200 text-stone-700 font-bold py-3 rounded-xl text-sm bg-stone-100"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </motion.div>
  );
}

