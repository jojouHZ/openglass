#!/usr/bin/env python3
"""
OpenGlass Documentation Vectorizer
Converts markdown documentation to vector embeddings for Qdrant knowledge base.
Uses hierarchical smart chunking and BGE-large embeddings (1024-dimensional).
"""

import os
import re
import sys
import json
import hashlib
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any
import markdown
from bs4 import BeautifulSoup

try:
    from sentence_transformers import SentenceTransformer
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
except ImportError:
    print("Installing required packages...")
    os.system("pip install sentence-transformers qdrant-client beautifulsoup4 markdown")
    from sentence_transformers import SentenceTransformer
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue


class MarkdownChunker:
    """Hierarchical smart chunking for markdown documents."""
    
    def __init__(self):
        self.chunking_strategy = {
            'document_level': 0,
            'section_level': 1, 
            'subsection_level': 2,
            'paragraph_level': 3
        }
    
    def parse_markdown_hierarchy(self, content: str, file_path: str) -> List[Dict[str, Any]]:
        """Parse markdown into hierarchical chunks with metadata."""
        chunks = []
        
        # Convert markdown to HTML for easier parsing
        html = markdown.markdown(content)
        soup = BeautifulSoup(html, 'html.parser')
        
        # Extract document level chunk (summary)
        doc_chunk = self._create_document_chunk(content, file_path, soup)
        chunks.append(doc_chunk)
        
        # Extract hierarchical sections
        current_section = None
        current_subsection = None
        
        for element in soup.find_all(['h1', 'h2', 'h3', 'h4', 'p', 'pre', 'ul', 'ol']):
            if element.name.startswith('h'):
                level = int(element.name[1])
                text = element.get_text().strip()
                
                if level == 1:
                    current_section = text
                    current_subsection = None
                elif level == 2:
                    current_subsection = text
                elif level == 3:
                    # Create subsection chunk
                    chunk = self._create_section_chunk(
                        element, file_path, level, current_section, current_subsection
                    )
                    chunks.append(chunk)
                    
            elif element.name in ['p', 'pre', 'ul', 'ol']:
                # Create paragraph/code chunk
                chunk = self._create_paragraph_chunk(
                    element, file_path, current_section, current_subsection
                )
                if chunk['text'].strip():  # Only add non-empty chunks
                    chunks.append(chunk)
        
        return chunks
    
    def _create_document_chunk(self, content: str, file_path: str, soup: BeautifulSoup) -> Dict[str, Any]:
        """Create document-level summary chunk."""
        # Extract first paragraph as summary
        first_p = soup.find('p')
        summary = first_p.get_text().strip() if first_p else content[:200]
        
        return {
            'text': summary,
            'level': self.chunking_strategy['document_level'],
            'chunk_type': 'document_summary',
            'source_file': file_path,
            'parent_section': None,
            'metadata': {
                'document_length': len(content),
                'title': soup.find('h1').get_text().strip() if soup.find('h1') else 'Untitled'
            }
        }
    
    def _create_section_chunk(self, element, file_path: str, level: int, 
                            section: str, subsection: str) -> Dict[str, Any]:
        """Create section-level chunk."""
        text = element.get_text().strip()
        
        return {
            'text': text,
            'level': level,
            'chunk_type': 'section',
            'source_file': file_path,
            'parent_section': section,
            'subsection': subsection,
            'metadata': {
                'heading': text,
                'section': section,
                'subsection': subsection
            }
        }
    
    def _create_paragraph_chunk(self, element, file_path: str, 
                               section: str, subsection: str) -> Dict[str, Any]:
        """Create paragraph-level chunk."""
        if element.name == 'pre':
            text = element.get_text().strip()
            chunk_type = 'code'
        elif element.name in ['ul', 'ol']:
            text = element.get_text().strip()
            chunk_type = 'list'
        else:
            text = element.get_text().strip()
            chunk_type = 'paragraph'
        
        return {
            'text': text,
            'level': self.chunking_strategy['paragraph_level'],
            'chunk_type': chunk_type,
            'source_file': file_path,
            'parent_section': section,
            'subsection': subsection,
            'metadata': {
                'section': section,
                'subsection': subsection
            }
        }


class DocumentationVectorizor:
    """Main vectorization pipeline for OpenGlass documentation."""
    
    def __init__(self, qdrant_url: str = "localhost", qdrant_port: int = 6333):
        self.qdrant_client = QdrantClient(host=qdrant_url, port=qdrant_port)
        self.chunker = MarkdownChunker()
        
        # Use BGE-large for 1024-dimensional embeddings
        print("Loading BGE-large model (1024-dimensional)...")
        self.model = SentenceTransformer('BAAI/bge-large-en-v1.5')
        print("Model loaded successfully!")
        
        self.collection_name = "openglass_docs"
        
    def determine_case_type(self, file_path: str) -> str:
        """Determine the type of documentation case."""
        if 'success_cases' in file_path:
            return 'success'
        elif 'bad_cases' in file_path:
            return 'bad'
        elif 'rollbacks' in file_path:
            return 'rollback'
        elif 'architecture' in file_path:
            return 'architecture'
        else:
            return 'general'
    
    def extract_agent_info(self, file_path: str) -> str:
        """Extract agent information from file path or content."""
        # Check if it's an agent skill file
        if 'skills' in file_path:
            agent_name = file_path.split('/')[-2]
            return agent_name
        return 'unknown'
    
    def create_chunks(self, file_path: str) -> List[Dict[str, Any]]:
        """Create hierarchical chunks from markdown file."""
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        chunks = self.chunker.parse_markdown_hierarchy(content, file_path)
        
        # Add metadata to each chunk
        case_type = self.determine_case_type(file_path)
        agent_info = self.extract_agent_info(file_path)
        
        for chunk in chunks:
            chunk['metadata'].update({
                'case_type': case_type,
                'agent': agent_info,
                'timestamp': datetime.now().isoformat(),
                'file_hash': hashlib.md5(content.encode()).hexdigest()
            })
        
        return chunks
    
    def create_embeddings(self, chunks: List[Dict[str, Any]]) -> List[List[float]]:
        """Create embeddings for chunks using BGE-large."""
        texts = [chunk['text'] for chunk in chunks]
        embeddings = self.model.encode(texts, show_progress_bar=True)
        return embeddings.tolist()
    
    def setup_qdrant_collection(self):
        """Setup Qdrant collection with 1024-dimensional vectors."""
        try:
            # Check if collection exists
            collections = self.qdrant_client.get_collections()
            collection_names = [col.name for col in collections.collections]
            
            if self.collection_name in collection_names:
                print(f"Collection '{self.collection_name}' already exists")
                return
            
            # Create new collection
            self.qdrant_client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(
                    size=1024,  # BGE-large produces 1024-dimensional vectors
                    distance=Distance.COSINE
                )
            )
            print(f"Collection '{self.collection_name}' created successfully")
            
        except Exception as e:
            print(f"Error setting up Qdrant collection: {e}")
    
    def vectorize_document(self, file_path: str) -> Dict[str, Any]:
        """Vectorize a single document and upload to Qdrant."""
        print(f"Processing: {file_path}")
        
        # Create chunks
        chunks = self.create_chunks(file_path)
        print(f"Created {len(chunks)} chunks")
        
        # Create embeddings
        embeddings = self.create_embeddings(chunks)
        print(f"Created {len(embeddings)} embeddings")
        
        # Prepare points for Qdrant
        points = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            point_id = self._generate_point_id(file_path, i)
            
            point = PointStruct(
                id=point_id,
                vector=embedding,
                payload={
                    'text': chunk['text'],
                    'source_file': chunk['source_file'],
                    'chunk_type': chunk['chunk_type'],
                    'level': chunk['level'],
                    'parent_section': chunk['parent_section'],
                    'subsection': chunk.get('subsection'),
                    'case_type': chunk['metadata']['case_type'],
                    'agent': chunk['metadata']['agent'],
                    'timestamp': chunk['metadata']['timestamp'],
                    'file_hash': chunk['metadata']['file_hash'],
                    **chunk['metadata']
                }
            )
            points.append(point)
        
        # Upload to Qdrant
        try:
            self.qdrant_client.upsert(
                collection_name=self.collection_name,
                points=points
            )
            print(f"Successfully uploaded {len(points)} points to Qdrant")
            
            return {
                'file': file_path,
                'chunks': len(chunks),
                'points': len(points),
                'status': 'success'
            }
            
        except Exception as e:
            print(f"Error uploading to Qdrant: {e}")
            return {
                'file': file_path,
                'chunks': len(chunks),
                'points': 0,
                'status': 'error',
                'error': str(e)
            }
    
    def _generate_point_id(self, file_path: str, chunk_index: int) -> int:
        """Generate unique point ID (Qdrant accepts uint64 or UUID only)."""
        digest = hashlib.md5(f"{file_path}_{chunk_index}".encode()).hexdigest()
        return int(digest[:16], 16)
    
    def vectorize_directory(self, directory: str) -> List[Dict[str, Any]]:
        """Vectorize all markdown files in a directory."""
        results = []
        
        # Find all markdown files
        markdown_files = list(Path(directory).rglob("*.md"))
        
        print(f"Found {len(markdown_files)} markdown files")
        
        for file_path in markdown_files:
            result = self.vectorize_document(str(file_path))
            results.append(result)
        
        return results
    
    def search_similar(self, query: str, limit: int = 3, 
                      case_filter: str = None) -> List[Dict[str, Any]]:
        """Search for similar documentation."""
        # Create embedding for query
        query_embedding = self.model.encode(query).tolist()
        
        # Build filter if case filter is specified
        search_filter = None
        if case_filter:
            search_filter = Filter(
                must=[
                    FieldCondition(
                        key="case_type",
                        match=MatchValue(value=case_filter)
                    )
                ]
            )
        
        # Search in Qdrant
        results = self.qdrant_client.query_points(
            collection_name=self.collection_name,
            query=query_embedding,
            limit=limit,
            query_filter=search_filter
        ).points
        
        # Format results
        formatted_results = []
        for result in results:
            formatted_results.append({
                'text': result.payload['text'],
                'source_file': result.payload['source_file'],
                'chunk_type': result.payload['chunk_type'],
                'case_type': result.payload['case_type'],
                'score': result.score
            })
        
        return formatted_results


def main():
    """Main execution function."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Vectorize OpenGlass documentation')
    parser.add_argument('--directory', '-d', default='docs', 
                       help='Directory containing markdown files')
    parser.add_argument('--file', '-f', help='Single file to vectorize')
    parser.add_argument('--search', '-s', help='Search query')
    parser.add_argument('--case-filter', '-c', 
                       choices=['success', 'bad', 'rollback', 'architecture', 'general'],
                       help='Filter by case type')
    parser.add_argument('--qdrant-url', default='localhost', 
                       help='Qdrant server URL')
    parser.add_argument('--qdrant-port', type=int, default=6333, 
                       help='Qdrant server port (REST)')
    
    args = parser.parse_args()
    
    # Initialize vectorizor
    vectorizor = DocumentationVectorizor(
        qdrant_url=args.qdrant_url,
        qdrant_port=args.qdrant_port
    )
    
    # Setup Qdrant collection
    vectorizor.setup_qdrant_collection()
    
    if args.search:
        # Search mode
        print(f"Searching for: {args.search}")
        results = vectorizor.search_similar(
            args.search, 
            case_filter=args.case_filter
        )
        
        print("\nSearch Results:")
        for i, result in enumerate(results, 1):
            print(f"\n{i}. {result['source_file']} (Score: {result['score']:.4f})")
            print(f"   Type: {result['case_type']} | {result['chunk_type']}")
            print(f"   Text: {result['text'][:200]}...")
            
    elif args.file:
        # Single file mode
        result = vectorizor.vectorize_document(args.file)
        print(f"Result: {result}")
        if result['status'] == 'error':
            sys.exit(1)
        
    else:
        # Directory mode
        results = vectorizor.vectorize_directory(args.directory)
        
        print("\nVectorization Summary:")
        successful = sum(1 for r in results if r['status'] == 'success')
        failed = sum(1 for r in results if r['status'] == 'error')
        total_chunks = sum(r['chunks'] for r in results)
        total_points = sum(r['points'] for r in results)
        
        print(f"Files processed: {len(results)}")
        print(f"Successful: {successful}")
        print(f"Failed: {failed}")
        print(f"Total chunks: {total_chunks}")
        print(f"Total points uploaded: {total_points}")
        
        if failed > 0 or (len(results) > 0 and total_points == 0):
            sys.exit(1)


if __name__ == "__main__":
    main()