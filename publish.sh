#!/bin/bash

# Daytona Drizzle Proxy - NPM Publish Script
# This script automates the process of publishing the package to NPM

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to get package name and version from package.json
get_package_info() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        PACKAGE_NAME=$(grep '"name"' package.json | sed 's/.*"name": *"\([^"]*\)".*/\1/')
        PACKAGE_VERSION=$(grep '"version"' package.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')
    else
        # Linux and others
        PACKAGE_NAME=$(grep -oP '(?<="name": ")[^"]*' package.json)
        PACKAGE_VERSION=$(grep -oP '(?<="version": ")[^"]*' package.json)
    fi
}

echo "🚀 Daytona Drizzle Proxy - NPM Publisher"
echo "======================================"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Please run this script from the project root."
    exit 1
fi

# Check required tools
print_status "Checking required tools..."

if ! command_exists npm; then
    print_error "npm is not installed. Please install Node.js and npm first."
    exit 1
fi

if ! command_exists bun; then
    print_error "bun is not installed. Please install Bun first: https://bun.sh"
    exit 1
fi

print_success "All required tools are available"

# Get package information
get_package_info
print_status "Package: $PACKAGE_NAME@$PACKAGE_VERSION"

# Check if user is logged in to NPM
print_status "Checking NPM authentication..."
if ! npm whoami >/dev/null 2>&1; then
    print_warning "You are not logged in to NPM."
    echo "Please log in with your NPM credentials:"
    npm login
    
    if ! npm whoami >/dev/null 2>&1; then
        print_error "NPM login failed. Please try again."
        exit 1
    fi
fi

NPM_USER=$(npm whoami)
print_success "Logged in as: $NPM_USER"

# Check if package name is available
print_status "Checking package name availability..."
if npm view "$PACKAGE_NAME" >/dev/null 2>&1; then
    EXISTING_VERSION=$(npm view "$PACKAGE_NAME" version 2>/dev/null)
    if [ "$EXISTING_VERSION" = "$PACKAGE_VERSION" ]; then
        print_error "Version $PACKAGE_VERSION already exists for $PACKAGE_NAME"
        echo "Please update the version in package.json and try again."
        exit 1
    else
        print_warning "Package $PACKAGE_NAME already exists (current: $EXISTING_VERSION)"
        echo "This will publish version $PACKAGE_VERSION"
    fi
else
    print_success "Package name $PACKAGE_NAME is available"
fi

# Confirm publication
echo ""
echo "📋 Publication Summary:"
echo "  Package: $PACKAGE_NAME"
echo "  Version: $PACKAGE_VERSION"
echo "  NPM User: $NPM_USER"
echo ""

read -p "Do you want to proceed with publication? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_warning "Publication cancelled by user"
    exit 0
fi

# Clean and build
print_status "Cleaning previous build..."
rm -rf dist/

print_status "Building package..."
if ! bun run build; then
    print_error "Build failed. Please fix build errors and try again."
    exit 1
fi

print_success "Build completed successfully"

# Verify build output
if [ ! -d "dist" ] || [ ! -f "dist/index.js" ]; then
    print_error "Build output not found. Please check your build configuration."
    exit 1
fi

# Run a quick test
print_status "Running basic CLI test..."
if ! timeout 3 bun run src/index.ts --version >/dev/null 2>&1; then
    print_warning "CLI test failed, but continuing with publication..."
fi

# Publish to NPM
print_status "Publishing to NPM..."
if npm publish; then
    print_success "🎉 Package published successfully!"
    echo ""
    echo "Your package is now available at:"
    echo "  https://www.npmjs.com/package/$PACKAGE_NAME"
    echo ""
    echo "Users can install it with:"
    echo "  npm install -g $PACKAGE_NAME"
    echo ""
    echo "To test your published package:"
    echo "  npm install -g $PACKAGE_NAME"
    echo "  $PACKAGE_NAME --help"
else
    print_error "Publication failed. Please check the error messages above."
    exit 1
fi

# Optional: Test the published package
echo ""
read -p "Would you like to test the published package by installing it globally? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_status "Installing published package for testing..."
    
    # Uninstall local version if exists
    npm uninstall -g "$PACKAGE_NAME" >/dev/null 2>&1 || true
    
    # Install from NPM
    if npm install -g "$PACKAGE_NAME"; then
        print_success "Package installed successfully!"
        echo ""
        echo "Testing the CLI:"
        if command_exists daytona-drizzle-proxy; then
            daytona-drizzle-proxy --version
            print_success "✅ CLI is working correctly!"
        else
            print_warning "CLI command not found in PATH. You may need to restart your terminal."
        fi
    else
        print_error "Failed to install the published package"
    fi
fi

print_success "Publication process completed! 🎉"