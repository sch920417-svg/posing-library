import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Camera, Upload, Users, Baby, User, UserPlus, X, Search, Trash2, Filter, Image as ImageIcon, Save, Check, Plus, Minus, Maximize2, ChevronLeft, ChevronRight, Dog, Heart, AlignLeft, Settings } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyChDWPVbPXOhqoKCNU5gC9UA1z9z8rH6TY",
  authDomain: "family-posing-library.firebaseapp.com",
  projectId: "family-posing-library",
  storageBucket: "family-posing-library.firebasestorage.app",
  messagingSenderId: "561313353465",
  appId: "1:561313353465:web:6f88efaa46625e0d3b5c28"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'studio-main'; // 이 부분도 꼭 이렇게 바꿔주세요!

// --- Constants & Options ---
const GRANDPARENT_OPTIONS = [
  { value: 'none', label: '없음' },
  { value: 'grandfather', label: '👴 할아버지' },
  { value: 'grandmother', label: '👵 할머니' },
  { value: 'both', label: '👴👵 조부모 모두' },
];

const PARENT_OPTIONS = [
  { value: 'none', label: '없음' },
  { value: 'mom', label: '👩 엄마' },
  { value: 'dad', label: '👨 아빠' },
  { value: 'both', label: '👩‍❤️‍👨 부모 모두' },
];

const CHILD_OPTIONS = [
  { id: 'newborn', label: '👶 신생아 (0–100일)' },
  { id: 'toddler', label: '🍼 영유아 (돌~4세)' },
  { id: 'kid', label: '🎒 유아·초등 (5–13세)' },
  { id: 'teen', label: '🧑 중·고등학생' },
  { id: 'adult_child', label: '🧑‍🎓 성인 자녀 (20대 이상)' },
];

// --- Utility: Smart Resize & Compression for Firestore Limit (1MB) ---
const processImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');
        
        let width = img.width;
        let height = img.height;
        const MAX_DIMENSION = 1600; 

        if (width > height) {
          if (width > MAX_DIMENSION) {
            height = Math.round(height * (MAX_DIMENSION / width));
            width = MAX_DIMENSION;
          }
        } else {
          if (height > MAX_DIMENSION) {
            width = Math.round(width * (MAX_DIMENSION / height));
            height = MAX_DIMENSION;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const MAX_SIZE_BYTES = 1000000; 
        let quality = 0.9;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);

        while (dataUrl.length > MAX_SIZE_BYTES * 1.33 && quality > 0.5) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        
        if (dataUrl.length > MAX_SIZE_BYTES * 1.33) {
            const scaleFactor = 0.7;
            canvas.width *= scaleFactor;
            canvas.height *= scaleFactor;
            ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        }

        resolve(dataUrl);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

export default function App() {
  const [user, setUser] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  
  // Multiple Images State
  const [selectedImages, setSelectedImages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  
  // Viewer State
  const [viewingPhotoId, setViewingPhotoId] = useState(null); 

  // Edit State
  const [editData, setEditData] = useState(null);

  // -- Upload State --
  const [uploadData, setUploadData] = useState({
    headCount: 3,
    grandparents: 'none',
    parents: 'both',
    children: [], 
    petCount: 0, 
    memo: '', // 추가된 메모 필드
  });

  // -- Filter State --
  const [filters, setFilters] = useState({
    headCount: 'all',
    grandparents: 'all',
    parents: 'all',
    children: [], 
    includePets: false, 
    onlyFavorites: false, // 즐겨찾기 필터
  });

  // --- Auth & Data Fetching ---
  useEffect(() => {
    const initAuth = async () => {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else {
            await signInAnonymously(auth);
        }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'artifacts', appId, 'users', user.uid, 'posing_refs'),
      orderBy('createdAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedPhotos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPhotos(loadedPhotos);
    }, (error) => {
        console.error("Error fetching photos:", error);
    });
    return () => unsubscribe();
  }, [user]);

  // --- Handlers ---

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    if (selectedImages.length + files.length > 10) {
      alert("한 번에 최대 10장까지만 업로드할 수 있습니다.");
      return;
    }

    try {
      const processedBase64Images = await Promise.all(files.map(file => processImage(file)));
      setSelectedImages(prev => [...prev, ...processedBase64Images]);
    } catch (err) {
      alert("이미지 처리 중 오류가 발생했습니다.");
    }
    
    // Reset input value to allow re-selecting the same file if needed
    e.target.value = '';
  };

  const removeSelectedImage = (indexToRemove) => {
    setSelectedImages(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // Upload Modal Child Handler
  const toggleUploadChildTag = (tagId) => {
    setUploadData(prev => {
      const exists = prev.children.find(c => c.id === tagId);
      if (exists) {
        return { ...prev, children: prev.children.filter(c => c.id !== tagId) };
      } else {
        return { ...prev, children: [...prev.children, { id: tagId, count: 1 }] };
      }
    });
  };

  const handleUploadChildCountChange = (e, tagId, delta) => {
    e.stopPropagation();
    setUploadData(prev => ({
      ...prev,
      children: prev.children.map(c => {
        if (c.id === tagId) {
          const newCount = Math.max(1, c.count + delta);
          return { ...c, count: newCount };
        }
        return c;
      })
    }));
  };

  // Upload Pet Handler
  const toggleUploadPet = () => {
    setUploadData(prev => ({
        ...prev,
        petCount: prev.petCount > 0 ? 0 : 1
    }));
  };

  const handleUploadPetCountChange = (e, delta) => {
    e.stopPropagation();
    setUploadData(prev => ({
        ...prev,
        petCount: Math.max(1, prev.petCount + delta)
    }));
  };

  // --- Edit Handlers ---
  const handleOpenEditModal = (e, photo) => {
    e.stopPropagation();
    setEditData({
      id: photo.id,
      headCount: photo.headCount || 1,
      grandparents: photo.grandparents || 'none',
      parents: photo.parents || 'none',
      children: photo.children || [],
      petCount: photo.petCount || 0,
      memo: photo.memo || '',
      imageUrl: photo.imageUrl
    });
  };

  const toggleEditChildTag = (tagId) => {
    setEditData(prev => {
      const exists = prev.children.find(c => c.id === tagId);
      if (exists) {
        return { ...prev, children: prev.children.filter(c => c.id !== tagId) };
      } else {
        return { ...prev, children: [...prev.children, { id: tagId, count: 1 }] };
      }
    });
  };

  const handleEditChildCountChange = (e, tagId, delta) => {
    e.stopPropagation();
    setEditData(prev => ({
      ...prev,
      children: prev.children.map(c => {
        if (c.id === tagId) {
          const newCount = Math.max(1, c.count + delta);
          return { ...c, count: newCount };
        }
        return c;
      })
    }));
  };

  const toggleEditPet = () => {
    setEditData(prev => ({
        ...prev,
        petCount: prev.petCount > 0 ? 0 : 1
    }));
  };

  const handleEditPetCountChange = (e, delta) => {
    e.stopPropagation();
    setEditData(prev => ({
        ...prev,
        petCount: Math.max(1, prev.petCount + delta)
    }));
  };

  const handleEditSave = async () => {
    if (!editData || !user) return;
    setIsUploading(true);
    try {
      const childrenTags = editData.children.map(c => c.id);
      await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'posing_refs', editData.id), {
        headCount: parseInt(editData.headCount),
        grandparents: editData.grandparents,
        parents: editData.parents,
        children: editData.children,
        childrenTags: childrenTags,
        petCount: editData.petCount,
        memo: editData.memo,
      });
      setEditData(null);
    } catch (error) {
      console.error("Edit failed", error);
      alert("수정 중 오류가 발생했습니다.");
    } finally {
      setIsUploading(false);
    }
  };

  // Filter Sidebar Child Handler
  const toggleFilterChildTag = (tagId) => {
    setFilters(prev => {
      const exists = prev.children.find(c => c.id === tagId);
      if (exists) {
        return { ...prev, children: prev.children.filter(c => c.id !== tagId) };
      } else {
        return { ...prev, children: [...prev.children, { id: tagId, count: 1 }] };
      }
    });
  };

  const handleFilterChildCountChange = (e, tagId, delta) => {
    e.stopPropagation();
    setFilters(prev => ({
      ...prev,
      children: prev.children.map(c => {
        if (c.id === tagId) {
          const newCount = Math.max(1, c.count + delta);
          return { ...c, count: newCount };
        }
        return c;
      })
    }));
  };

  const handleUpload = async () => {
    if (selectedImages.length === 0 || !user) return;
    setIsUploading(true);

    try {
      const childrenTags = uploadData.children.map(c => c.id);
      
      // Shared data for all uploaded images in this batch
      const commonData = {
        headCount: parseInt(uploadData.headCount),
        grandparents: uploadData.grandparents,
        parents: uploadData.parents,
        children: uploadData.children, 
        childrenTags: childrenTags,
        petCount: uploadData.petCount, 
        memo: uploadData.memo, // 메모 저장
        isFavorite: false, // 기본적으로 즐겨찾기 해제 상태로 저장
        createdAt: serverTimestamp(),
      };

      // Create a promise for each image to be uploaded concurrently
      const uploadPromises = selectedImages.map(imgDataUrl => {
        return addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'posing_refs'), {
            imageUrl: imgDataUrl,
            ...commonData
        });
      });

      await Promise.all(uploadPromises);
      
      setIsUploadModalOpen(false);
      setSelectedImages([]);
      setUploadData({
        headCount: 3,
        grandparents: 'none',
        parents: 'both',
        children: [],
        petCount: 0,
        memo: '',
      });
    } catch (error) {
      console.error("Upload failed", error);
      alert("일부 이미지 저장에 실패했습니다. (용량 제한 등)");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (e, docId) => {
    e.stopPropagation(); 
    if (!confirm('이 레퍼런스를 삭제하시겠습니까?')) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'posing_refs', docId));
      if (viewingPhotoId === docId) setViewingPhotoId(null);
    } catch (e) {
      console.error(e);
    }
  };

  // Toggle Favorite Status
  const handleToggleFavorite = async (e, docId, currentStatus) => {
    e.stopPropagation();
    if (!user) return;
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'posing_refs', docId), {
        isFavorite: !currentStatus
      });
    } catch (error) {
      console.error("Error updating favorite status:", error);
    }
  };

  // --- Filtering Logic ---
  const filteredPhotos = useMemo(() => {
    return photos.filter(photo => {
      // Favorite Filter
      if (filters.onlyFavorites && !photo.isFavorite) return false;

      if (filters.headCount !== 'all' && photo.headCount !== parseInt(filters.headCount)) return false;
      if (filters.grandparents !== 'all' && photo.grandparents !== filters.grandparents) return false;
      if (filters.parents !== 'all' && photo.parents !== filters.parents) return false;
      
      // Pet Filter Logic
      if (filters.includePets && (!photo.petCount || photo.petCount < 1)) return false;

      if (filters.children.length > 0) {
        const hasMatch = filters.children.every(filterChild => {
            if (photo.children && typeof photo.children[0] !== 'string') {
                const match = photo.children.find(pc => pc.id === filterChild.id);
                return match && match.count === filterChild.count;
            } 
            else {
                const photoTags = photo.childrenTags || photo.children || [];
                return photoTags.includes(filterChild.id);
            }
        });
        if (!hasMatch) return false;
      }

      return true;
    });
  }, [photos, filters]);

  // --- Viewer Logic ---
  const handleNextPhoto = (e) => {
    e?.stopPropagation();
    if (!viewingPhotoId) return;
    const currentIndex = filteredPhotos.findIndex(p => p.id === viewingPhotoId);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + 1) % filteredPhotos.length;
    setViewingPhotoId(filteredPhotos[nextIndex].id);
  };

  const handlePrevPhoto = (e) => {
    e?.stopPropagation();
    if (!viewingPhotoId) return;
    const currentIndex = filteredPhotos.findIndex(p => p.id === viewingPhotoId);
    if (currentIndex === -1) return;
    const prevIndex = (currentIndex - 1 + filteredPhotos.length) % filteredPhotos.length;
    setViewingPhotoId(filteredPhotos[prevIndex].id);
  };

  // Touch Swipe Logic for Viewer
  const touchStart = useRef(null);
  const touchEnd = useRef(null);

  const onTouchStart = (e) => {
    touchEnd.current = null; 
    touchStart.current = e.targetTouches[0].clientX;
  };

  const onTouchMove = (e) => {
    touchEnd.current = e.targetTouches[0].clientX;
  };

  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;
    const distance = touchStart.current - touchEnd.current;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;

    if (isLeftSwipe) {
        handleNextPhoto();
    }
    if (isRightSwipe) {
        handlePrevPhoto();
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
        if (!viewingPhotoId) return;
        if (e.key === 'ArrowRight') handleNextPhoto();
        if (e.key === 'ArrowLeft') handlePrevPhoto();
        if (e.key === 'Escape') setViewingPhotoId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewingPhotoId, filteredPhotos]);


  // --- Render Helpers ---
  const getLabel = (options, value) => options.find(o => o.value === value)?.label || value;
  
  const renderChildTag = (childItem) => {
    if (typeof childItem === 'string') {
        const label = CHILD_OPTIONS.find(c => c.id === childItem)?.label.split(' ')[0] + ' ' + CHILD_OPTIONS.find(c => c.id === childItem)?.label.split(' ')[1];
        return <span className="text-xs bg-neutral-700 px-1.5 py-0.5 rounded text-neutral-300">{label}</span>;
    }
    const label = CHILD_OPTIONS.find(c => c.id === childItem.id)?.label.split(' ')[0] + ' ' + CHILD_OPTIONS.find(c => c.id === childItem.id)?.label.split(' ')[1];
    return (
        <span className="text-xs bg-neutral-700 px-1.5 py-0.5 rounded text-neutral-300 flex items-center gap-1">
            {label}
            {childItem.count > 1 && <span className="text-rose-400 font-bold text-[10px] bg-neutral-800 px-1 rounded-full">{childItem.count}</span>}
        </span>
    );
  };

  const viewingPhoto = useMemo(() => filteredPhotos.find(p => p.id === viewingPhotoId), [filteredPhotos, viewingPhotoId]);


  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans selection:bg-rose-500 selection:text-white">
      
      {/* Header */}
      <header className="bg-neutral-800 border-b border-neutral-700 sticky top-0 z-10 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-6 h-6 text-rose-500" />
            <h1 className="text-xl font-bold tracking-tight">Studio Posing Library</h1>
          </div>
          <button 
            onClick={() => setIsUploadModalOpen(true)}
            className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors font-medium text-sm shadow-md"
          >
            <Upload className="w-4 h-4" />
            시안 업로드
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 flex flex-col lg:flex-row gap-6">
        
        {/* Left Sidebar: Filters */}
        <aside className="w-full lg:w-80 flex-shrink-0 space-y-6">
          <div className="bg-neutral-800 p-5 rounded-xl border border-neutral-700 shadow-sm sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between mb-6 border-b border-neutral-700 pb-3">
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-rose-500" />
                <h2 className="font-semibold text-lg">필터 검색</h2>
              </div>
              <button 
                onClick={() => setFilters({ headCount: 'all', grandparents: 'all', parents: 'all', children: [], includePets: false, onlyFavorites: false })}
                className="text-xs text-neutral-400 hover:text-white transition-colors"
              >
                초기화
              </button>
            </div>

            <div className="space-y-6">
              
              {/* Filter: Favorite Toggle */}
              <div className="bg-rose-500/5 p-3 rounded-lg border border-rose-500/20">
                 <button
                    onClick={() => setFilters(prev => ({...prev, onlyFavorites: !prev.onlyFavorites}))}
                    className="w-full flex items-center justify-between text-sm"
                >
                    <div className="flex items-center gap-2 text-rose-300 font-medium">
                        <Heart className={`w-4 h-4 ${filters.onlyFavorites ? 'fill-rose-500 text-rose-500' : ''}`} />
                        즐겨찾는 시안만 보기
                    </div>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${filters.onlyFavorites ? 'bg-rose-500' : 'bg-neutral-700'}`}>
                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${filters.onlyFavorites ? 'translate-x-4' : ''}`} />
                    </div>
                </button>
              </div>

              {/* Filter: Headcount */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">총 인원수</label>
                <select 
                  value={filters.headCount}
                  onChange={(e) => setFilters({...filters, headCount: e.target.value})}
                  className="w-full bg-neutral-900 border border-neutral-600 rounded-lg p-2.5 focus:border-rose-500 outline-none text-sm transition-colors"
                >
                  <option value="all">모든 인원</option>
                  {[...Array(20)].map((_, i) => (
                    <option key={i} value={i + 1}>{i + 1}인</option>
                  ))}
                </select>
              </div>

              {/* Filter: Composition (Grandparents) */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">조부모 구성</label>
                <select 
                  value={filters.grandparents}
                  onChange={(e) => setFilters({...filters, grandparents: e.target.value})}
                  className="w-full bg-neutral-900 border border-neutral-600 rounded-lg p-2.5 focus:border-rose-500 outline-none text-sm"
                >
                  <option value="all">전체</option>
                  {GRANDPARENT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Filter: Composition (Parents) */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">부모 구성</label>
                <select 
                  value={filters.parents}
                  onChange={(e) => setFilters({...filters, parents: e.target.value})}
                  className="w-full bg-neutral-900 border border-neutral-600 rounded-lg p-2.5 focus:border-rose-500 outline-none text-sm"
                >
                  <option value="all">전체</option>
                  {PARENT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Filter: Children */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">자녀 구성 및 인원</label>
                <div className="flex flex-col gap-2">
                  {CHILD_OPTIONS.map(child => {
                    const selectedItem = filters.children.find(c => c.id === child.id);
                    const isSelected = !!selectedItem;
                    const count = selectedItem ? selectedItem.count : 0;

                    return (
                        <div 
                          key={child.id}
                          className={`
                            rounded-lg border transition-all overflow-hidden flex flex-col
                            ${isSelected 
                              ? 'bg-rose-500/10 border-rose-500' 
                              : 'bg-neutral-900 border-neutral-700 hover:border-neutral-500'}
                          `}
                        >
                           <button
                              onClick={() => toggleFilterChildTag(child.id)}
                              className={`w-full p-2.5 text-left flex items-center gap-2 ${isSelected ? 'text-white' : 'text-neutral-400'}`}
                          >
                              <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${isSelected ? 'border-rose-500 bg-rose-500' : 'border-neutral-600'}`}>
                                  {isSelected && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <span className="truncate text-sm">{child.label}</span>
                          </button>

                          {isSelected && (
                              <div className="flex items-center justify-between bg-rose-900/30 px-3 py-1.5 border-t border-rose-500/30">
                                  <span className="text-xs text-rose-300 font-semibold">{count}명</span>
                                  <div className="flex items-center gap-1">
                                      <button 
                                          onClick={(e) => handleFilterChildCountChange(e, child.id, -1)}
                                          className="p-1 hover:bg-rose-500/20 rounded text-rose-200"
                                          disabled={count <= 1}
                                      >
                                          <Minus className="w-3 h-3" />
                                      </button>
                                      <button 
                                          onClick={(e) => handleFilterChildCountChange(e, child.id, 1)}
                                          className="p-1 hover:bg-rose-500/20 rounded text-rose-200"
                                      >
                                          <Plus className="w-3 h-3" />
                                      </button>
                                  </div>
                              </div>
                          )}
                        </div>
                    );
                  })}
                </div>
              </div>

               {/* Filter: Pet */}
               <div className="space-y-2">
                <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">반려동물</label>
                <button
                    onClick={() => setFilters(prev => ({...prev, includePets: !prev.includePets}))}
                    className={`w-full p-2.5 rounded-lg border flex items-center gap-2 transition-all ${
                        filters.includePets 
                        ? 'bg-rose-500/10 border-rose-500 text-white' 
                        : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-500'
                    }`}
                >
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${filters.includePets ? 'border-rose-500 bg-rose-500' : 'border-neutral-600'}`}>
                        {filters.includePets && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <Dog className="w-4 h-4" />
                    <span className="text-sm">반려견 포함</span>
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Content: Gallery */}
        <div className="flex-1">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-medium text-neutral-300">
              검색 결과 <span className="text-rose-500 font-bold ml-1">{filteredPhotos.length}</span>건
            </h3>
          </div>

          {filteredPhotos.length === 0 ? (
            <div className="h-96 flex flex-col items-center justify-center text-neutral-500 border-2 border-dashed border-neutral-800 rounded-2xl bg-neutral-800/30">
              <ImageIcon className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-lg">해당 조건의 레퍼런스가 없습니다.</p>
              <p className="text-sm mt-2">조건을 변경하거나 새로운 시안을 업로드해주세요.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredPhotos.map(photo => (
                <div 
                  key={photo.id} 
                  onClick={() => setViewingPhotoId(photo.id)}
                  className="group relative bg-neutral-800 rounded-xl overflow-hidden border border-neutral-700 shadow-sm hover:shadow-xl transition-all hover:border-rose-500/50 cursor-pointer flex flex-col"
                >
                  {/* Image with strict 4:5 Aspect Ratio & Cover Fit */}
                  <div className="aspect-[4/5] bg-neutral-900 overflow-hidden relative">
                    <img 
                      src={photo.imageUrl} 
                      alt="Posing Reference" 
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    
                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
                        <Maximize2 className="text-white opacity-0 group-hover:opacity-100 transform scale-75 group-hover:scale-100 transition-all drop-shadow-lg w-8 h-8" />
                    </div>
                    
                    {/* Top Action Buttons (Favorite & Delete) */}
                    <div className="absolute top-3 left-3 z-10">
                      <button 
                        onClick={(e) => handleToggleFavorite(e, photo.id, photo.isFavorite)}
                        className={`p-2 rounded-full transition-all backdrop-blur-sm ${photo.isFavorite ? 'bg-rose-500/20 text-rose-500 hover:bg-rose-500/40' : 'bg-black/50 text-white/70 hover:text-white hover:bg-black/70'}`}
                        title={photo.isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                      >
                        <Heart className={`w-4 h-4 ${photo.isFavorite ? 'fill-current' : ''}`} />
                      </button>
                    </div>

                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex gap-2">
                      <button 
                        onClick={(e) => handleOpenEditModal(e, photo)}
                        className="p-2 bg-black/50 text-white rounded-full hover:bg-blue-600 transition-colors backdrop-blur-sm"
                        title="설정 및 수정"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={(e) => handleDelete(e, photo.id)}
                        className="p-2 bg-black/50 text-white rounded-full hover:bg-red-600 transition-colors backdrop-blur-sm"
                        title="삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Info Card */}
                  <div className="p-4 flex-1 flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <span className="bg-neutral-100 text-neutral-900 text-xs font-bold px-2 py-0.5 rounded">
                          {photo.headCount}인
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      {photo.grandparents !== 'none' && (
                        <div className="flex items-center gap-2 text-sm text-neutral-300">
                          <UserPlus className="w-3.5 h-3.5 text-rose-400" />
                          <span>{getLabel(GRANDPARENT_OPTIONS, photo.grandparents)}</span>
                        </div>
                      )}
                      {photo.parents !== 'none' && (
                        <div className="flex items-center gap-2 text-sm text-neutral-300">
                          <Users className="w-3.5 h-3.5 text-blue-400" />
                          <span>{getLabel(PARENT_OPTIONS, photo.parents)}</span>
                        </div>
                      )}
                      {(photo.children?.length > 0 || (Array.isArray(photo.children) && photo.children.length > 0)) && (
                        <div className="flex items-start gap-2 text-sm text-neutral-300 mt-1">
                          <Baby className="w-3.5 h-3.5 text-yellow-400 mt-0.5" />
                          <div className="flex flex-wrap gap-1">
                            {photo.children.map((c, idx) => (
                                <React.Fragment key={idx}>
                                    {renderChildTag(c)}
                                </React.Fragment>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Pet Display in Card */}
                      {photo.petCount > 0 && (
                        <div className="flex items-center gap-2 text-sm text-neutral-300 mt-1">
                            <Dog className="w-3.5 h-3.5 text-rose-400" />
                            <span className="text-xs bg-neutral-700 px-1.5 py-0.5 rounded text-neutral-300">
                                반려견 {photo.petCount}마리
                            </span>
                        </div>
                      )}
                    </div>

                    {/* Memo Display in Card */}
                    {photo.memo && (
                        <div className="mt-auto pt-3 border-t border-neutral-700/50 flex items-start gap-2 text-xs text-neutral-400">
                            <AlignLeft className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-neutral-500" />
                            <p className="line-clamp-2 leading-relaxed">{photo.memo}</p>
                        </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Lightbox Modal (High Quality Viewer with Slide & Swipe) */}
      {viewingPhoto && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={() => setViewingPhotoId(null)}
        >
          {/* Navigation Controls */}
          {filteredPhotos.length > 1 && (
            <>
                <button 
                    onClick={handlePrevPhoto}
                    className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all z-[70] hidden md:block"
                >
                    <ChevronLeft className="w-10 h-10" />
                </button>
                <button 
                    onClick={handleNextPhoto}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all z-[70] hidden md:block"
                >
                    <ChevronRight className="w-10 h-10" />
                </button>
            </>
          )}

          {/* Top Controls */}
          <div className="absolute top-6 right-6 flex items-center gap-4 z-[70]">
             <button 
                onClick={(e) => handleOpenEditModal(e, viewingPhoto)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full transition-all backdrop-blur-sm border bg-white/10 border-white/10 text-white hover:bg-white/20"
             >
                <Settings className="w-4 h-4" />
                <span className="text-xs font-bold">설정 수정</span>
             </button>
             <button 
                onClick={(e) => handleToggleFavorite(e, viewingPhoto.id, viewingPhoto.isFavorite)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all backdrop-blur-sm border ${viewingPhoto.isFavorite ? 'bg-rose-500/20 border-rose-500 text-rose-400' : 'bg-white/10 border-white/10 text-white hover:bg-white/20'}`}
             >
                <Heart className={`w-4 h-4 ${viewingPhoto.isFavorite ? 'fill-current' : ''}`} />
                <span className="text-xs font-bold">{viewingPhoto.isFavorite ? '즐겨찾기 취소' : '즐겨찾기'}</span>
             </button>
             <button 
                onClick={() => setViewingPhotoId(null)}
                className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
             >
               <X className="w-8 h-8" />
             </button>
          </div>
          
          {/* Image Container with Swipe Detection */}
          <div 
            className="relative w-full h-full flex flex-col items-center justify-center"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onClick={(e) => e.stopPropagation()} 
          >
            <img 
              src={viewingPhoto.imageUrl} 
              alt="Full Size Reference" 
              className="w-auto h-auto max-w-full max-h-[85vh] object-contain rounded-sm shadow-2xl select-none"
            />
            
            {/* Memo Display in Viewer */}
            {viewingPhoto.memo && (
                <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-auto bg-black/70 backdrop-blur-md px-6 py-4 rounded-xl border border-white/10 shadow-2xl max-w-2xl text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                        <AlignLeft className="w-4 h-4 text-rose-400" />
                        <span className="text-xs font-bold text-rose-400 uppercase tracking-widest">촬영 팁</span>
                    </div>
                    <p className="text-white text-sm leading-relaxed">{viewingPhoto.memo}</p>
                </div>
            )}

            {/* Slide Indicator Overlay (Mobile Hint) */}
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-white/30 text-xs px-3 py-1 bg-black/20 rounded-full backdrop-blur-sm md:hidden">
                ↔ 좌우로 밀어서 이동
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editData && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-neutral-800 w-full max-w-3xl rounded-2xl shadow-2xl border border-neutral-700 flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-neutral-700">
              <div className="flex items-center gap-3">
                <Settings className="w-5 h-5 text-rose-500" />
                <h2 className="text-xl font-bold text-white">레퍼런스 설정 수정</h2>
              </div>
              <button onClick={() => setEditData(null)} className="text-neutral-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-8">
              {/* Image Preview */}
              <div className="space-y-3">
                <label className="block text-sm font-bold text-neutral-300">원본 사진</label>
                <div className="w-32 h-40 rounded-lg border border-neutral-600 overflow-hidden bg-neutral-900">
                    <img src={editData.imageUrl} alt="Edit Preview" className="w-full h-full object-cover" />
                </div>
              </div>

              <hr className="border-neutral-700" />

              {/* Tagging Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 1. Headcount */}
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-neutral-300">총 인원수</label>
                  <select 
                    value={editData.headCount}
                    onChange={(e) => setEditData({...editData, headCount: parseInt(e.target.value)})}
                    className="w-full bg-neutral-900 border border-neutral-600 rounded-lg p-3 focus:border-rose-500 outline-none"
                  >
                    {[...Array(20)].map((_, i) => (
                      <option key={i} value={i + 1}>{i + 1}명</option>
                    ))}
                  </select>
                </div>

                {/* 2. Parents */}
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-neutral-300">부모 구성</label>
                  <select 
                    value={editData.parents}
                    onChange={(e) => setEditData({...editData, parents: e.target.value})}
                    className="w-full bg-neutral-900 border border-neutral-600 rounded-lg p-3 focus:border-rose-500 outline-none"
                  >
                    {PARENT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* 3. Grandparents */}
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-neutral-300">조부모 구성</label>
                  <select 
                    value={editData.grandparents}
                    onChange={(e) => setEditData({...editData, grandparents: e.target.value})}
                    className="w-full bg-neutral-900 border border-neutral-600 rounded-lg p-3 focus:border-rose-500 outline-none"
                  >
                    {GRANDPARENT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

              </div>

              {/* 4. Children (Multi-select with Count) */}
              <div className="space-y-3">
                <label className="block text-sm font-bold text-neutral-300">
                    자녀 구성 & 인원 수
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {CHILD_OPTIONS.map(child => {
                    const selectedItem = editData.children.find(c => c.id === child.id);
                    const isSelected = !!selectedItem;
                    const count = selectedItem ? selectedItem.count : 0;

                    return (
                      <div 
                        key={child.id}
                        className={`
                          relative rounded-lg border transition-all overflow-hidden flex flex-col
                          ${isSelected 
                            ? 'bg-rose-500/10 border-rose-500' 
                            : 'bg-neutral-900 border-neutral-700 hover:border-neutral-500'}
                        `}
                      >
                        <button
                            onClick={() => toggleEditChildTag(child.id)}
                            className={`w-full p-3 text-left flex items-center gap-2 ${isSelected ? 'text-white' : 'text-neutral-400'}`}
                        >
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${isSelected ? 'border-rose-500 bg-rose-500' : 'border-neutral-600'}`}>
                                {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <span className="truncate text-sm font-medium">{child.label}</span>
                        </button>

                        {isSelected && (
                            <div className="flex items-center justify-between bg-rose-900/30 px-3 py-1.5 border-t border-rose-500/30">
                                <span className="text-xs text-rose-300 font-semibold">{count}명</span>
                                <div className="flex items-center gap-1">
                                    <button 
                                        onClick={(e) => handleEditChildCountChange(e, child.id, -1)}
                                        className="p-1 hover:bg-rose-500/20 rounded text-rose-200"
                                        disabled={count <= 1}
                                    >
                                        <Minus className="w-3 h-3" />
                                    </button>
                                    <button 
                                        onClick={(e) => handleEditChildCountChange(e, child.id, 1)}
                                        className="p-1 hover:bg-rose-500/20 rounded text-rose-200"
                                    >
                                        <Plus className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

               {/* 5. Pets Section */}
               <div className="space-y-3">
                <label className="block text-sm font-bold text-neutral-300">
                    반려동물
                </label>
                <div className={`
                    relative rounded-lg border transition-all overflow-hidden flex flex-col w-full md:w-1/2
                    ${editData.petCount > 0 
                    ? 'bg-rose-500/10 border-rose-500' 
                    : 'bg-neutral-900 border-neutral-700 hover:border-neutral-500'}
                `}>
                     <button
                        onClick={toggleEditPet}
                        className={`w-full p-3 text-left flex items-center gap-2 ${editData.petCount > 0 ? 'text-white' : 'text-neutral-400'}`}
                    >
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${editData.petCount > 0 ? 'border-rose-500 bg-rose-500' : 'border-neutral-600'}`}>
                            {editData.petCount > 0 && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <Dog className="w-4 h-4" />
                        <span className="truncate text-sm font-medium">반려견</span>
                    </button>

                    {editData.petCount > 0 && (
                         <div className="flex items-center justify-between bg-rose-900/30 px-3 py-1.5 border-t border-rose-500/30">
                            <span className="text-xs text-rose-300 font-semibold">{editData.petCount}마리</span>
                            <div className="flex items-center gap-1">
                                <button 
                                    onClick={(e) => handleEditPetCountChange(e, -1)}
                                    className="p-1 hover:bg-rose-500/20 rounded text-rose-200"
                                    disabled={editData.petCount <= 1}
                                >
                                    <Minus className="w-3 h-3" />
                                </button>
                                <button 
                                    onClick={(e) => handleEditPetCountChange(e, 1)}
                                    className="p-1 hover:bg-rose-500/20 rounded text-rose-200"
                                >
                                    <Plus className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
               </div>

               {/* 6. Memo Section */}
               <div className="space-y-2">
                 <label className="block text-sm font-bold text-neutral-300">
                    촬영 팁 / 메모
                 </label>
                 <textarea 
                    value={editData.memo}
                    onChange={(e) => setEditData({...editData, memo: e.target.value})}
                    placeholder="예: 애플박스 2개 사용, 창가 자연광, 하이앵글 촬영 등"
                    className="w-full bg-neutral-900 border border-neutral-600 rounded-lg p-3 text-sm text-white focus:border-rose-500 outline-none resize-none h-24 custom-scrollbar"
                 />
               </div>

            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-neutral-700 flex justify-end gap-3 bg-neutral-800 rounded-b-2xl">
              <button 
                onClick={() => setEditData(null)}
                className="px-6 py-2.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-700 font-medium transition-colors"
              >
                취소
              </button>
              <button 
                onClick={handleEditSave}
                disabled={isUploading}
                className="px-6 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium shadow-lg hover:shadow-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
              >
                {isUploading ? '저장 중...' : (
                  <>
                    <Save className="w-4 h-4" />
                    수정 완료
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Upload Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-neutral-800 w-full max-w-3xl rounded-2xl shadow-2xl border border-neutral-700 flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-neutral-700">
              <div className="flex items-center gap-3">
                <Upload className="w-5 h-5 text-rose-500" />
                <h2 className="text-xl font-bold text-white">새 레퍼런스 일괄 등록</h2>
                {selectedImages.length > 0 && (
                    <span className="bg-rose-500/20 text-rose-400 text-xs font-bold px-2.5 py-1 rounded-full border border-rose-500/30">
                        {selectedImages.length}/10 장 선택됨
                    </span>
                )}
              </div>
              <button onClick={() => setIsUploadModalOpen(false)} className="text-neutral-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="p-6 overflow-y-auto flex-1 space-y-8">
              
              {/* Image Input (Multi-select Grid) */}
              <div className="space-y-3">
                <label className="block text-sm font-bold text-neutral-300">사진 선택 (최대 10장)</label>
                
                <div className="flex flex-wrap gap-4">
                  {selectedImages.map((imgSrc, idx) => (
                    <div key={idx} className="relative w-28 h-36 rounded-lg border border-neutral-600 overflow-hidden group shadow-md">
                        <img src={imgSrc} alt={`Preview ${idx}`} className="w-full h-full object-cover" />
                        <button 
                            onClick={() => removeSelectedImage(idx)} 
                            className="absolute top-1.5 right-1.5 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                  ))}

                  {/* Add File Button */}
                  {selectedImages.length < 10 && (
                    <label className={`
                        w-28 h-36 rounded-lg border-2 border-dashed border-neutral-600 flex flex-col items-center justify-center cursor-pointer hover:border-rose-500 hover:bg-rose-500/5 transition-all
                        ${selectedImages.length === 0 ? 'w-full md:w-64 aspect-video md:aspect-auto' : ''}
                    `}>
                        <ImageIcon className="w-8 h-8 text-neutral-500 mb-2" />
                        <span className="text-xs text-neutral-400 font-medium">
                            {selectedImages.length === 0 ? '클릭하여 여러 장 선택' : '사진 추가'}
                        </span>
                        <input 
                            type="file" 
                            accept="image/*"
                            multiple // 다중 선택 허용
                            onChange={handleFileSelect}
                            className="hidden"
                        />
                    </label>
                  )}
                </div>
                
                {selectedImages.length === 0 && (
                    <div className="text-sm text-neutral-400 pt-1">
                        <p>한 가족의 다양한 포즈 컷을 여러 장 동시에 올려보세요.</p>
                        <p className="text-rose-500 text-xs font-bold mt-1">* 한 번의 태그 설정으로 모든 사진에 동일하게 적용됩니다.</p>
                    </div>
                )}
              </div>

              <hr className="border-neutral-700" />

              {/* Tagging Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 1. Headcount */}
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-neutral-300">총 인원수</label>
                  <select 
                    value={uploadData.headCount}
                    onChange={(e) => setUploadData({...uploadData, headCount: parseInt(e.target.value)})}
                    className="w-full bg-neutral-900 border border-neutral-600 rounded-lg p-3 focus:border-rose-500 outline-none"
                  >
                    {[...Array(20)].map((_, i) => (
                      <option key={i} value={i + 1}>{i + 1}명</option>
                    ))}
                  </select>
                </div>

                {/* 2. Parents */}
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-neutral-300">부모 구성</label>
                  <select 
                    value={uploadData.parents}
                    onChange={(e) => setUploadData({...uploadData, parents: e.target.value})}
                    className="w-full bg-neutral-900 border border-neutral-600 rounded-lg p-3 focus:border-rose-500 outline-none"
                  >
                    {PARENT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* 3. Grandparents */}
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-neutral-300">조부모 구성</label>
                  <select 
                    value={uploadData.grandparents}
                    onChange={(e) => setUploadData({...uploadData, grandparents: e.target.value})}
                    className="w-full bg-neutral-900 border border-neutral-600 rounded-lg p-3 focus:border-rose-500 outline-none"
                  >
                    {GRANDPARENT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

              </div>

              {/* 4. Children (Multi-select with Count) */}
              <div className="space-y-3">
                <label className="block text-sm font-bold text-neutral-300">
                    자녀 구성 & 인원 수
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {CHILD_OPTIONS.map(child => {
                    const selectedItem = uploadData.children.find(c => c.id === child.id);
                    const isSelected = !!selectedItem;
                    const count = selectedItem ? selectedItem.count : 0;

                    return (
                      <div 
                        key={child.id}
                        className={`
                          relative rounded-lg border transition-all overflow-hidden flex flex-col
                          ${isSelected 
                            ? 'bg-rose-500/10 border-rose-500' 
                            : 'bg-neutral-900 border-neutral-700 hover:border-neutral-500'}
                        `}
                      >
                        <button
                            onClick={() => toggleUploadChildTag(child.id)}
                            className={`w-full p-3 text-left flex items-center gap-2 ${isSelected ? 'text-white' : 'text-neutral-400'}`}
                        >
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${isSelected ? 'border-rose-500 bg-rose-500' : 'border-neutral-600'}`}>
                                {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <span className="truncate text-sm font-medium">{child.label}</span>
                        </button>

                        {isSelected && (
                            <div className="flex items-center justify-between bg-rose-900/30 px-3 py-1.5 border-t border-rose-500/30">
                                <span className="text-xs text-rose-300 font-semibold">{count}명</span>
                                <div className="flex items-center gap-1">
                                    <button 
                                        onClick={(e) => handleUploadChildCountChange(e, child.id, -1)}
                                        className="p-1 hover:bg-rose-500/20 rounded text-rose-200"
                                        disabled={count <= 1}
                                    >
                                        <Minus className="w-3 h-3" />
                                    </button>
                                    <button 
                                        onClick={(e) => handleUploadChildCountChange(e, child.id, 1)}
                                        className="p-1 hover:bg-rose-500/20 rounded text-rose-200"
                                    >
                                        <Plus className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

               {/* 5. Pets Section */}
               <div className="space-y-3">
                <label className="block text-sm font-bold text-neutral-300">
                    반려동물
                </label>
                <div className={`
                    relative rounded-lg border transition-all overflow-hidden flex flex-col w-full md:w-1/2
                    ${uploadData.petCount > 0 
                    ? 'bg-rose-500/10 border-rose-500' 
                    : 'bg-neutral-900 border-neutral-700 hover:border-neutral-500'}
                `}>
                     <button
                        onClick={toggleUploadPet}
                        className={`w-full p-3 text-left flex items-center gap-2 ${uploadData.petCount > 0 ? 'text-white' : 'text-neutral-400'}`}
                    >
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${uploadData.petCount > 0 ? 'border-rose-500 bg-rose-500' : 'border-neutral-600'}`}>
                            {uploadData.petCount > 0 && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <Dog className="w-4 h-4" />
                        <span className="truncate text-sm font-medium">반려견</span>
                    </button>

                    {uploadData.petCount > 0 && (
                         <div className="flex items-center justify-between bg-rose-900/30 px-3 py-1.5 border-t border-rose-500/30">
                            <span className="text-xs text-rose-300 font-semibold">{uploadData.petCount}마리</span>
                            <div className="flex items-center gap-1">
                                <button 
                                    onClick={(e) => handleUploadPetCountChange(e, -1)}
                                    className="p-1 hover:bg-rose-500/20 rounded text-rose-200"
                                    disabled={uploadData.petCount <= 1}
                                >
                                    <Minus className="w-3 h-3" />
                                </button>
                                <button 
                                    onClick={(e) => handleUploadPetCountChange(e, 1)}
                                    className="p-1 hover:bg-rose-500/20 rounded text-rose-200"
                                >
                                    <Plus className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
               </div>

               {/* 6. Memo Section */}
               <div className="space-y-2">
                 <label className="block text-sm font-bold text-neutral-300">
                    촬영 팁 / 메모 <span className="text-neutral-500 font-normal">(선택사항)</span>
                 </label>
                 <textarea 
                    value={uploadData.memo}
                    onChange={(e) => setUploadData({...uploadData, memo: e.target.value})}
                    placeholder="예: 애플박스 2개 사용, 창가 자연광, 하이앵글 촬영 등 (이 메모는 선택된 모든 사진에 공통 적용됩니다)"
                    className="w-full bg-neutral-900 border border-neutral-600 rounded-lg p-3 text-sm text-white focus:border-rose-500 outline-none resize-none h-24 custom-scrollbar"
                 />
               </div>

            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-neutral-700 flex justify-end gap-3 bg-neutral-800 rounded-b-2xl">
              <button 
                onClick={() => setIsUploadModalOpen(false)}
                className="px-6 py-2.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-700 font-medium transition-colors"
              >
                취소
              </button>
              <button 
                onClick={handleUpload}
                disabled={selectedImages.length === 0 || isUploading}
                className="px-6 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium shadow-lg hover:shadow-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
              >
                {isUploading ? '일괄 저장 중...' : (
                  <>
                    <Save className="w-4 h-4" />
                    일괄 저장하기
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
