import React, { useState } from 'react';
import type { GradingResult } from './geminiService';

interface Props {
  grading: GradingResult;
}

/**
 * Shows the student's transcribed answer next to the cropped image of their actual handwriting.
 * This lets the teacher visually verify that the transcription matches what the student wrote.
 */
export const StudentAnswerView: React.FC<Props> = ({ grading }) => {
  const [showFullSize, setShowFullSize] = useState(false);

  const hasImage = !!grading.studentAnswerImage;
  const imageSrc = hasImage ? `data:image/jpeg;base64,${grading.studentAnswerImage}` : null;

  return (
    <div style={{
      border: '1px solid #e0e0e0',
      borderRadius: 8,
      padding: 12,
      marginBottom: 10,
      backgroundColor: '#fafafa'
    }}>
      {/* Transcribed text */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          إجابة الطالب (منسوخة):
        </div>
        <div style={{
          padding: '8px 12px',
          backgroundColor: '#fff',
          border: '1px solid #ddd',
          borderRadius: 6,
          fontFamily: 'monospace',
          direction: 'ltr',
          textAlign: 'left',
          minHeight: 32
        }}>
          {grading.studentAnswer || '—'}
        </div>
      </div>

      {/* Cropped handwriting image — the verification proof */}
      {hasImage && imageSrc && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
            صورة من خط الطالب (اضغط للتكبير):
          </div>
          <img
            src={imageSrc}
            alt="صورة جواب الطالب من ورقة الامتحان"
            onClick={() => setShowFullSize(!showFullSize)}
            style={{
              maxWidth: showFullSize ? '100%' : 320,
              maxHeight: showFullSize ? 600 : 120,
              border: '2px solid #4caf50',
              borderRadius: 6,
              cursor: 'pointer',
              backgroundColor: '#fff',
              display: 'block'
            }}
          />
          <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
            ⚠️ تحقق بصرياً: هل النص المنسوخ يطابق ما كتبه الطالب في الصورة؟
          </div>
        </div>
      )}

      {/* Grade and feedback */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div style={{
          padding: '4px 10px',
          backgroundColor: grading.grade === 0 ? '#ffebee' : '#e8f5e9',
          color: grading.grade === 0 ? '#c62828' : '#2e7d32',
          borderRadius: 4,
          fontWeight: 'bold',
          fontSize: 14
        }}>
          {grading.grade} / {(grading as any).maxGrade ?? '?'}
        </div>
      </div>

      {grading.feedback && (
        <div style={{
          marginTop: 8,
          padding: '6px 10px',
          fontSize: 13,
          color: '#555',
          backgroundColor: '#fff',
          borderRadius: 4,
          borderRight: '3px solid #2196f3'
        }}>
          {grading.feedback}
        </div>
      )}
    </div>
  );
};
